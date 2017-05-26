var CARTODB_USER = 'greeninfo';

var DBTABLE_EDGES = "ecglines_clean_unique";

var ROUTER = {
    // main entry point
    // start lat, start lng, end lat, end lng
    findRoute: function (start_lat, start_lng, target_lat, target_lng, success_callback, failure_callback) {
        var self = this;

        // a database handle
        var db = new cartodb.SQL({ user: CARTODB_USER });

        // is this northbound or southbound? the edges and cues are tagged with N/S/B as a proxy for one-way behavior
        var northbound = start_lat >= target_lat;

        // find the best edges for our starting and ending location
        var start_edge, target_edge;
        var get_edge_sql = "SELECT pline_id AS id, title, ST_XMAX(the_geom) AS e, ST_XMIN(the_geom) AS w, ST_YMIN(the_geom) AS s, ST_YMAX(the_geom) AS n FROM " + DBTABLE_EDGES + " ORDER BY the_geom <-> ST_SETSRID(ST_MAKEPOINT({{ lng }}, {{ lat }}), 4326) LIMIT 1";
        db.execute(get_edge_sql, { lng: start_lng, lat: start_lat })
        .done(function(data) {
            start_edge = data.rows[0];

            db.execute(get_edge_sql, { lng: target_lng, lat: target_lat })
            .done(function(data) {
                target_edge = data.rows[0];

                console.log([ 'start edge', start_lat, start_lng, start_edge ]);
                console.log([ 'target edge', target_lat, target_lng, target_edge ]);

                // fetch relevant route segments: allowed for northbound/southbound paths
                // and with a bounding box filter to fetch only the relevant area, e.g. no Boston routes for a route within Florida
                // tip: in theory a box of 0.2 degrees (10-12 miles-ish) could work, but for larger loops that just isn't right
                // even loading the whole dataset is workable, but we'd rather not; so go with a pretty large buffer here
                var params = {
                    n: Math.max(target_edge.n, start_edge.n) + 3.0,
                    s: Math.min(target_edge.s, start_edge.s) - 3.0,
                    e: Math.max(target_edge.e, start_edge.e) + 3.0,
                    w: Math.min(target_edge.w, start_edge.w) - 3.0,
                    dir: northbound ? 'N' : 'S'
                };

                var geomtext = "ST_SIMPLIFY(the_geom,0.0001)"; // a teeny-tiny simplification to clean some of their flourishes that have wonky angles at starts and ends

                db.execute("SELECT pline_id AS id, title, meters, ST_ASTEXT(" + geomtext + ") AS geom FROM " + DBTABLE_EDGES + " WHERE DIRECTION IN ('B', '{{ dir }}') AND the_geom && ST_MAKEENVELOPE({{ w }}, {{ s }}, {{ e }}, {{ n }}, 4326)", params)
                .done(function(data) {
                    var wktreader = new jsts.io.WKTReader();
                    var gfactory  = new jsts.geom.GeometryFactory();

                    data.rows = data.rows.map(function (segment) {
                        // data massage as we load the lines

                        // add the ID+title as a single "debug" flag; makes debugging easier
                        segment.debug = segment.id + ' ' + segment.title;

                        // - convert the WKT geometry to a JSTS geometry
                        // - add the starting point and ending point, kept as-is; for "purity" e.g. decorating the line or adding an icon)
                        // - add the starting point and ending point, with a buffer; provides "snapping" for finding other candidate lines
                        // - add the centroid of this line segment; a "general sense" of its location for Manhattan heuristic
                        segment.geom = wktreader.read(segment.geom);

                        segment.centroid = segment.geom.getCentroid();

                        var mypoints       = segment.geom.getCoordinates();
                        segment.firstpoint = gfactory.createPoint(mypoints[0]);
                        segment.lastpoint  = gfactory.createPoint(mypoints[ mypoints.length-1 ]);

                        var snaptolerance = 0.004; // about 100 ft; the topology is very broken
                        segment.firstpointsnap = segment.firstpoint.buffer(snaptolerance, 10);
                        segment.lastpointsnap  = segment.lastpoint.buffer(snaptolerance, 10);

                        // done
                        return segment;
                    });

                    // hand off to our path-finder
                    // give the results back to our callback
                    try {
                        var route = self.assemblePath(start_edge, target_edge, data.rows, northbound);
                        success_callback(route);
                    }
                    catch (errmsg) {
                        failure_callback(errmsg);
                    }
                });
            });
        });
    },
    assemblePath: function (start_edge, target_edge, universe_segments, northbound) {
        var self = this;

        // a list of edges which we have determined are wrong: wrong forks, wrong direction
        var poisoned = {};

        // from our universe, extract the target edge
        // we'll refer to this to check our distance to see whethwe r're going right or wrong (Manhattan heuristic)
        var target_geom = universe_segments.filter(function (segment) {
            return segment.id == target_edge.id;
        })[0];

        // start by pulling from the universe, our first edge
        // then poison it so we don't try to re-cross our own starting point
        var route = universe_segments.filter(function (segment) {
            return segment.id == start_edge.id;
        });
        poisoned[ start_edge.id ] = true;

        // the big loop
        // starting at our latest segment, find all other segments which touch it (more or less) and they are candidates for our next step
        // unless they've been poisoned (tagged as backward)
        while (true) {
            var here = route[ route.length-1 ];
            if (here.id == target_edge.id) console.log([ "arrived", here.debug ]);
            if (here.id == target_edge.id) break; // we're there! done!

            console.log([ "current location:", here.debug ]);
            var candidates = universe_segments.filter(function (candidate) {
                if (poisoned[candidate.id]) return false;
                return candidate.firstpointsnap.contains(here.firstpoint) || candidate.firstpointsnap.contains(here.lastpoint) || candidate.lastpointsnap.contains(here.firstpoint)  || candidate.lastpointsnap.contains(here.lastpoint);
            });

            var nextsegment = null;
            if (candidates.length == 1) {
                // only 1 candidate = okay, guess that's our way forward
                // explicitly set fork=false; maybe this step in our route was a fork, and we poisoned enough wrong forks that it's not a decision anymore
                here.fork = false;
                nextsegment = candidates[0];
            }
            else if (candidates.length) {
                // more than 1 unpoisoned candidate = this is a fork; pick one and move on
                // if we were wrong we'd eventually end up with 0 candidates, a dead end; see below
                console.log([ "fork detected here:", here.debug, 'candidates are:', candidates ]);
                here.fork = true;

                // Manhattan heuristic: whichever candidate is closer to our destination, is probably right
                candidates.sort(function (p, q) {
                    return p.centroid.distance(target_geom.centroid) <  q.centroid.distance(target_geom.centroid) ? -1 : 1;
                });
                nextsegment = candidates[0];
            }
            else {
                // no candidates at all? then we're at a dead end and it's not our destination
                here.fork = false;

                // find the last node in our route which is a fork
                // strip off the remainder of the route
                // then let nextsegment remain null, so our next pass will be on that fork node with one less option
                console.log([ 'dead end at:', here.debug ]);

                if (route.length < 2) {
                    console.log([ 'dead end at our start; there is no route', route ]);
                    throw "No route could be found between these locations.";
                    break;
                }

                for (var i=route.length-1 ; i >= 0; i--) {
                    if (! route[i].fork) continue;
                    console.log([ "last fork was at step:", i, route[i].debug ]);
                    route.splice(i+1);
                    console.log([ 'stripped back to', route[route.length-1].debug ]);
                    break;
                }
            }

            // add this segment to our route
            // then poison this segment so we won't try it again (backward is never a way forward)
            if (nextsegment) {
                poisoned[ nextsegment.id ] = true;
                route.push(nextsegment);
            }
        } // end of potentially infinite loop

        // done! hand off for more meta-processing, e.g. turn directions, endpoint snapping
        route = self.routeDecorate(route);
        return route;
    },
    routeDecorate: function (route) {
        // further cleanup of the solution graph

        // segment flipping -- align each step's ending vertex to the next line's starting vertex
        // this makes the vertices truly sequential along the route, which is relevant to:
        // - generating elevation profile charts, as one would want the elevations in sequence
        // - filling in gaps, by fudging the starting and ending points so they have the same vertex
        // - generating turning directions, where one lines changes into the next
        // http://gregorthemapguy.blogspot.com/2012/08/turning-directions-for-every-segment.html
        //
        // DON'T FORGET when flipping the linestring geometry TO ALSO update the firstpoint and lastpoint references
        // as we will likely be comparing them for later phases of work
        var gfactory = new jsts.geom.GeometryFactory();
        for (var i=0, l=route.length-2; i<=l; i++) {
            var thisstep = route[i];
            var nextstep = route[i+1];

            var dx11 = thisstep.firstpoint.distance(nextstep.firstpoint);
            var dx22 = thisstep.lastpoint.distance(nextstep.lastpoint);
            var dx12 = thisstep.firstpoint.distance(nextstep.lastpoint);
            var dx21 = thisstep.lastpoint.distance(nextstep.firstpoint);
            switch (Math.min(dx11, dx12, dx22, dx21)) {
                case dx21:
                    // this segment's end meets the next segment's start; great!
                    console.log([ 'segment end align', thisstep.debug, nextstep.debug, 'ok as is' ]);
                    break;
                case dx11:
                    // this segment's start meets the next segment's start; flip this one
                    console.log([ 'segment end align', thisstep.debug, nextstep.debug, 'flip this' ]);

                    thisstep.geom.geometries[0].points.coordinates.reverse();

                    var thispoints      = thisstep.geom.getCoordinates();
                    thisstep.firstpoint = gfactory.createPoint(thispoints[0]);
                    thisstep.lastpoint  = gfactory.createPoint(thispoints[ thispoints.length-1 ]);

                    break;
                case dx12:
                    // this segment's start meets the next segment's end; flip both
                    console.log([ 'segment end align', thisstep.debug, nextstep.debug, 'flip both' ]);

                    thisstep.geom.geometries[0].points.coordinates.reverse();
                    nextstep.geom.geometries[0].points.coordinates.reverse();

                    var thispoints      = thisstep.geom.getCoordinates();
                    thisstep.firstpoint = gfactory.createPoint(thispoints[0]);
                    thisstep.lastpoint  = gfactory.createPoint(thispoints[ thispoints.length-1 ]);

                    var nextpoints      = nextstep.geom.getCoordinates();
                    nextstep.firstpoint = gfactory.createPoint(nextpoints[0]);
                    nextstep.lastpoint  = gfactory.createPoint(nextpoints[ nextpoints.length-1 ]);

                    break;
                case dx22:
                    // this segment's end meets the next segment's end; flip next one
                    console.log([ 'segment end align', thisstep.debug, nextstep.debug, 'flip next' ]);

                    nextstep.geom.geometries[0].points.coordinates.reverse();

                    var nextpoints      = nextstep.geom.getCoordinates();
                    nextstep.firstpoint = gfactory.createPoint(nextpoints[0]);
                    nextstep.lastpoint  = gfactory.createPoint(nextpoints[ nextpoints.length-1 ]);

                    break;
            }
        }        

        // go through the transitions and clean up non-matching ends, which form visible breaks where the segments don't really touch
//GDA todo

        // go through the transitions and generate a directions attribute by comparing the azimuth of the old path and the new path
        // - human directions with the name "Turn right onto Schermerhorn Ct"
        // - simplified directions fitting a domain "R"
        // - latlong of this step-segment's lastpoint vertex for the location of this transition
        //
        // add to the final point a transition as well, so caller doesn't need to scramble with "if not segment.transition"

        var transition_codes = {
            RIGHT_TURN: { code: 'RT', text: "Turn right onto " },
            RIGHT_SOFT: { code: 'RS', text: "Bear right onto " },
            RIGHT_HARD: { code: 'RH', text: "Turn sharply right onto " },
            LEFT_TURN:  { code: 'LT', text: "Turn left onto " },
            LEFT_SOFT:  { code: 'LS', text: "Bear left onto " },
            LEFT_HARD:  { code: 'LH', text: "Turn sharply left onto " },
            STRAIGHT:   { code: 'ST', text: "Continue onto " },
            ARRIVE:     { code: 'AR', text: "Arrive" },
            OTHER:      { code: 'XX', text: "" },
        };

        function rad2deg (angle) {
            return angle * 57.29577951308232; // angle / Math.PI * 180
        }
        function deg2rad (angle) {
            return angle * 0.017453292519943295; // (angle / 180) * Math.PI;
        }

        for (var i=0, l=route.length-2; i<=l; i++) {
            var thisstep = route[i];
            var nextstep = route[i+1];

            // find the azimuth (compass heading) of the two paths, and the difference between the azimuths, thus the turning
            // the azimuth of the line's overall bent (firstpoint to lastpoint) is easily thrown off by curves characteristic of trails
            // the azimuth of the very first or last vertex-pair, is too sensitive to very tiny variations when drawing shapes e.g. hand jitters
            // so try the azimuth of the last 3 such pairs, if that many exist

            var thispoints = thisstep.geom.getCoordinates().slice(-3);
            var this_last = thispoints[ thispoints.length-1 ], this_prev = thispoints[0];

            var nextpoints = nextstep.geom.getCoordinates().slice(0, 3);
            var next_first = nextpoints[0], next_second = nextpoints[nextpoints.length-1];

            var thislon2 = this_prev.x, thislat2 = this_prev.y, thislon1 = this_last.x, thislat1 = this_last.y;
            var nextlon2 = next_first.x, nextlat2 = next_first.y, nextlon1 = next_second.x, nextlat1 = next_second.y;

            var thisaz = (180 + rad2deg(Math.atan2(Math.sin(deg2rad(thislon2) - deg2rad(thislon1)) * Math.cos(deg2rad(thislat2)), Math.cos(deg2rad(thislat1)) * Math.sin(deg2rad(thislat2)) - Math.sin(deg2rad(thislat1)) * Math.cos(deg2rad(thislat2)) * Math.cos(deg2rad(thislon2) - deg2rad(thislon1)))) ) % 360;
            var nextaz = (180 + rad2deg(Math.atan2(Math.sin(deg2rad(nextlon2) - deg2rad(nextlon1)) * Math.cos(deg2rad(nextlat2)), Math.cos(deg2rad(nextlat1)) * Math.sin(deg2rad(nextlat2)) - Math.sin(deg2rad(nextlat1)) * Math.cos(deg2rad(nextlat2)) * Math.cos(deg2rad(nextlon2) - deg2rad(nextlon1)))) ) % 360;
            var angle = Math.round(nextaz - thisaz);
            if (angle > 180)  angle = angle - 360;
            if (angle < -180) angle = angle + 360;
            console.log([ 'turning', thisstep.debug, nextstep.debug, thisaz, nextaz, angle ]);

            var turntype = transition_codes.OTHER;
            if      (angle >= -30 && angle <= 30)   turntype = transition_codes.STRAIGHT;
            else if (angle >= 31  && angle <= 60)   turntype = transition_codes.RIGHT_SOFT;
            else if (angle >= 61  && angle <= 100)  turntype = transition_codes.RIGHT_TURN;
            else if (angle >= 101)                  turntype = transition_codes.RIGHT_HARD;
            else if (angle <= -30 && angle >= -60)  turntype = transition_codes.LEFT_SOFT;
            else if (angle <= -61 && angle >= -100) turntype = transition_codes.LEFT_TURN;
            else if (angle <= -101)                 turntype = transition_codes.LEFT_HARD;

            thisstep.transition = {
                lat: thisstep.lastpoint.coordinates.coordinates[0].y, // wow, no method for this?
                lng: thisstep.lastpoint.coordinates.coordinates[0].x, // wow, no method for this?
                title: thisstep.title + ' to ' + nextstep.title,
                code: turntype.code,
                title: turntype.text + nextstep.title,
            };
        }

        var thisstep = route[route.length-1];
        thisstep.transition = {
            lat: thisstep.lastpoint.coordinates.coordinates[0].y, // wow, no method for this?
            lng: thisstep.lastpoint.coordinates.coordinates[0].x, // wow, no method for this?
            code: transition_codes.ARRIVE.code,
            title: transition_codes.ARRIVE.text,
        };

        // and Bob's your uncle
        return route;
    },
};
