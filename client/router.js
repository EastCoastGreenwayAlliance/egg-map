/*
 * ROUTER routing class for ECG data
 * Gregor Allensworth   gregor@greeninfo.org
 * apololgies in advance for it not being a proper ES6 class
 *
 * Params:
 * ROUTER.findRoute(start_lat, start_lng, target_lat, target_lng, success_callback, failure_callback)
 *
 * Return:
 * A GeoJSON-compliant structure suited for consumption by Leaflet or almost anything
 *
 * Feature properties are:
 * id -- The ID# of the line in CartoDB.
 * title -- The name of the road or trail which this line represents.
 * length -- Length of this section, in meters.
 * transition -- Metadata about the transition to the next segment on the route.
 * transition.title -- Human-readable text for this transition, e.g. "Turn left onto Hayward Avenue"
 * transition.lat -- The latitude at which the transition occurs.
 * transition.lng -- The longitude at which the transition occurs.
 * transition.code -- A domain code indicating the type of transition, e.g. "RT" for a right turn. This domain-coded version would be suited to selecting icons. Search this document for TRANSITION_CODES to see the list.
 *
 * Additionally, the structure contains a .properties attribute of its own, containing medatata about the route. The attributes of route.properties are as follows:
 * total_meters -- The total length of the route in meters, summed from the individual steps.
 * startpoint_wanted -- The desired starting latlng. GeoJSON-compliant point feature object.
 * endpoint_wanted -- The desired ending latlng. GeoJSON-compliant point feature object.
 * startpoint_trail -- The closest latlng on the route to the desired starting latlng. GeoJSON-compliant point feature object.
 * endpoint_trail -- The closest latlng on the route to the desired starting latlng. GeoJSON-compliant point feature object.
 * startpoint_meters -- The distance in meters, between startpoint_wanted and startpoint_trail.
 * endpoint_meters -- The distance in meters, between endpoint_wanted and endpoint_trail.
 */

var CARTODB_USER = 'greeninfo';

var DBTABLE_EDGES = "ecglines_clean_unique";

var ROUTER = {
    //
    // main entry point: find a route from start lat+lng to target lat+lng, prettied up with turning directions and all
    // wraps several other functions to find start/end nodes, assemble a path, clean up topology, add turning words, etc.
    // asynchronous: provide success + failure callbacks
    // success -- will be passed 1 param: a GeoJSON document of the segments representing the route
    // error -- will be passed 1 param: error message
    //
    findRoute: function (start_lat, start_lng, target_lat, target_lng, success_callback, failure_callback) {
        var self = this;

        // is this northbound or southbound? the edges and cues are tagged with N/S/B as a proxy for one-way behavior
        //TODO is that really how they want to do things?
        //TODO e.g. Pierson, FL to Daytona Beach, FL is east-northeast but the northern route is the longer
        //TODO perhaps the one-way field is better for this, indicating that travel must be in the direction of the vertices?
        var northbound = start_lat <= target_lat;

        // find the best edges for our starting and ending location
        self.findNearestSegmentToLatLng(start_lat, start_lng, northbound ? 'N' : 'S', function (start_segment) {
            self.findNearestSegmentToLatLng(target_lat, target_lng, northbound ? 'N' : 'S', function (target_segment) {
                console.log([ 'start segment', start_lat, start_lng, start_segment ]);
                console.log([ 'target segment', target_lat, target_lng, target_segment ]);

                // fetch relevant route segments
                // loading the whole dataset can be workable over a fast connection, but we'd rather not
                // and a bounding box filter to fetch only the relevant area; no path near Boston can be relevant to a route within Florida
                var params = {
                    n: Math.max(target_segment.n, start_segment.n) + 1.0,
                    s: Math.min(target_segment.s, start_segment.s) - 1.0,
                    e: Math.max(target_segment.e, start_segment.e) + 1.0,
                    w: Math.min(target_segment.w, start_segment.w) - 1.0,
                    dir: northbound ? 'N' : 'S'
                };

                var geomtext = "ST_SIMPLIFY(the_geom,0.0001)"; // a teeny-tiny simplification to clean some of their flourishes that have wonky angles at starts and ends

                var sql = "SELECT pline_id AS id, title, meters, ST_ASTEXT(" + geomtext + ") AS geom FROM " + DBTABLE_EDGES + " WHERE DIRECTION IN ('B', '{{ dir }}') AND the_geom && ST_MAKEENVELOPE({{ w }}, {{ s }}, {{ e }}, {{ n }}, 4326)";

                new cartodb.SQL({ user: CARTODB_USER })
                .execute(sql, params)
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

                        // done
                        return segment;
                    });

                    // hand off to our path-finder
                    // tack on some metadata to the resulting list of segments
                    // then pass the results through cleanup and serialization
                    console.log('downloaded ' + data.rows.length + ' segments, starting assembly');
                    try {
                        var route = self.assemblePath(start_segment, target_segment, data.rows, northbound);

                        route.start_lat      = start_lat;
                        route.start_lng      = start_lng;
                        route.target_lat     = target_lat;
                        route.target_lng     = target_lng;
                        route.start_segment  = start_segment;
                        route.target_segment = target_segment;

                        route = self.routeDecorate(route);
                        route = self.routeSerialize(route);
                        success_callback(route);
                    }
                    catch (errmsg) {
                        failure_callback(errmsg);
                    }
                })
                .error(function (errors) {
                    var errmsg = "error fetching lines universe: " + errors[0];
                    failure_callback(errmsg);
                });
            },
            function (errmsg) {
                failure_callback("error finding target segment: " + errmsg);
            })
        },
        function (errmsg) {
            failure_callback("error finding start segment: " + errmsg);
        });
    },

    //
    // utility function: find the nearest segment to the given latlng
    // asynchronous: provide success + failure callbacks
    // success -- will be passed 1 param: the resulting segment
    // error -- will be passed 1 param: error message
    //
    findNearestSegmentToLatLng: function (lat, lng, direction, success_callback, failure_callback) {
        var closest_segment;

        var directionclause = "TRUE";
        switch (direction) {
            case 'N': // N trails only
                directionclause = "direction IN ('B', 'N')"
                break;
            case 'S': // S trails only
                directionclause = "direction IN ('B', 'S')"
                break;
            default: // undefined, null, etc. do not filter by directionality
                break;
        }

        var sql = "SELECT pline_id AS id, title, ST_DISTANCE(the_geom::geography, ST_SETSRID(ST_MAKEPOINT({{ lng }}, {{ lat }}), 4326)::geography) AS closest_distance, ST_Y(ST_CLOSESTPOINT(the_geom, ST_SETSRID(ST_MAKEPOINT({{ lng }}, {{ lat }}), 4326))) AS closest_lat, ST_X(ST_CLOSESTPOINT(the_geom, ST_SETSRID(ST_MAKEPOINT({{ lng }}, {{ lat }}), 4326))) AS closest_lng, ST_XMAX(the_geom) AS e, ST_XMIN(the_geom) AS w, ST_YMIN(the_geom) AS s, ST_YMAX(the_geom) AS n FROM " + DBTABLE_EDGES + " WHERE " + directionclause + " ORDER BY the_geom <-> ST_SETSRID(ST_MAKEPOINT({{ lng }}, {{ lat }}), 4326) LIMIT 1";
        var params = { lng: lng, lat: lat };

        new cartodb.SQL({ user: CARTODB_USER })
        .execute(sql, params)
        .done(function(data) {
            closest_segment = data.rows[0];

            closest_segment.wanted_lat = lat; // decorate with the actually-requested lat+lng
            closest_segment.wanted_lng = lng; // decorate with the actually-requested lat+lng

            success_callback(closest_segment);
        })
        .error(function(errors) {
            var errmsg = "findNearestSegmentToLatLng failed: " + errors[0];
            failure_callback(errmsg);
        });
    },

    //
    // internal function: given a universe of edges/segments, find a path from start to end
    //
    assemblePath: function (start_segment, target_segment, universe_segments, northbound) {
        var self = this;

        // a list of edges which we have already traversed: so we never go backward esp. when exploring forks
        var poisoned = {};

        // from our universe, extract the target edge
        // we'll refer to this to check our distance to see whether we are going the right direction (Manhattan heuristic)
        var target_geom = universe_segments.filter(function (segment) {
            return segment.id == target_segment.id;
        })[0];

        // start by pulling from the universe, our first edge
        // then poison it so we don't try to re-cross our own starting point
        var route = universe_segments.filter(function (segment) {
            return segment.id == start_segment.id;
        });
        poisoned[ start_segment.id ] = true;

        // the big loop
        // starting at our latest segment, find all other segments which touch it (more or less) and they are candidates for our next step
        // unless they've been poisoned (tagged as backward)
        while (true) {
            var here = route[ route.length-1 ];
            if (here.id == target_segment.id) console.log([ "arrived", here.debug ]);
            if (here.id == target_segment.id) break; // we're there! done!

            console.log([ "current location:", here.debug ]);
            var candidates = universe_segments.filter(function (candidate) {
                // use this to debug if two segments aren't connecting but you think they should
                // compare their endpoint-to-endpoint distance to the tolerance below
                // tip: if the end-to-end distance is greater than the minimum distance, maybe the ends you see aren't really the ends, e.g. the line bends back over itself
                /*
                if (here.id == 661596 && candidate.id == 661598) {
                    console.log([ 'minimum distance between segments', here.geom.distance(candidate.geom) ]);
                    console.log([ 'distance to next segment first endpoint', here.geom.distance(candidate.firstpoint), here.geom.distance(candidate.firstpoint) <= 0.002 ]);
                    console.log([ 'distance to next segment last endpoint', here.geom.distance(candidate.lastpoint), here.geom.distance(candidate.lastpoint) <= 0.002 ]);
                }
                */

                var tolerance = 0.002; // about 50ft; the topology is bad but we should tolerate it
                if (poisoned[candidate.id]) return false;
                return here.geom.distance(candidate.firstpoint) <= tolerance || here.geom.distance(candidate.lastpoint) <= tolerance;
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

        // done assembling the path; hand back to caller, probably for postprocessing
        return route;
    },

    //
    // internal function: given a completed path from assemblePath() do some cleanup to it
    // flip segments end-to-end so they have a consistent sequence
    // give each segment a "transition" object describing the turn and the transition
    //
    routeDecorate: function (route) {
        // tip: Point.clone() does not work, thus the use of gfactory
        // also to compose new point objects based on route metadata
        var gfactory = new jsts.geom.GeometryFactory();

        // segment flipping -- align each step's ending vertex to the next line's starting vertex
        // this makes the vertices truly sequential along the route, which is relevant to:
        // - generating elevation profile charts, as one would want the elevations in sequence
        // - filling in gaps, by fudging the starting and ending points so they have the same vertex
        // - generating turning directions, where one lines changes into the next
        // http://gregorthemapguy.blogspot.com/2012/08/turning-directions-for-every-segment.html
        //
        // DON'T FORGET when flipping the linestring geometry TO ALSO update the firstpoint and lastpoint references
        // as we will likely be comparing them for later phases of work
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
        // effectively, fudge the last point of the previous trail to be the same as the first point of next, so they will overlap
        for (var i=0, l=route.length-2; i<=l; i++) {
            var thisstep = route[i];
            var nextstep = route[i+1];
            // if the distance between the two points is quite close, don't bother; the topology is destined for a significant cleanup which will solve many of them
            var dx = thisstep.lastpoint.distance(nextstep.firstpoint);
            if (dx < 0.0001) continue;

            // clone the next segment's starting point, append it to our linestring; don't forget to update our lastpoint
            // this is way off API, modifying the geometry in place
            var newpoint = gfactory.createPoint(nextstep.firstpoint.coordinates.coordinates[0]);
            console.log([ 'patching gap', thisstep.debug, nextstep.debug, newpoint ]);
            thisstep.geom.geometries[0].points.coordinates.push(newpoint.coordinates.coordinates[0]);
            thisstep.lastpoint = newpoint;
        }

        // go through the transitions and generate a directions attribute by comparing the azimuth of the old path and the new path
        // - human directions with the name "Turn right onto Schermerhorn Ct"
        // - simplified directions fitting a domain "R"
        // - latlong of this step-segment's lastpoint vertex for the location of this transition
        //
        // add to the final point a transition as well, so caller doesn't need to scramble with "if not segment.transition"

        var TRANSITION_CODES = {
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

            var turntype = TRANSITION_CODES.OTHER;
            if      (angle >= -30 && angle <= 30)   turntype = TRANSITION_CODES.STRAIGHT;
            else if (angle >= 31  && angle <= 60)   turntype = TRANSITION_CODES.RIGHT_SOFT;
            else if (angle >= 61  && angle <= 100)  turntype = TRANSITION_CODES.RIGHT_TURN;
            else if (angle >= 101)                  turntype = TRANSITION_CODES.RIGHT_HARD;
            else if (angle <= -30 && angle >= -60)  turntype = TRANSITION_CODES.LEFT_SOFT;
            else if (angle <= -61 && angle >= -100) turntype = TRANSITION_CODES.LEFT_TURN;
            else if (angle <= -101)                 turntype = TRANSITION_CODES.LEFT_HARD;

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
            code: TRANSITION_CODES.ARRIVE.code,
            title: TRANSITION_CODES.ARRIVE.text,
        };

        // metadata: the actually-requested starting latlng and target latlng
        route.wanted_start = gfactory.createPoint(new jsts.geom.Coordinate(route.start_segment.wanted_lng, route.start_segment.wanted_lat));
        route.wanted_end = gfactory.createPoint(new jsts.geom.Coordinate(route.target_segment.wanted_lng, route.target_segment.wanted_lat));

        // metadata: the closest point latlng and the closest distance, to our starting and ending segment
        // they already have these from findNearestSegmentToLatLng() but let's formalize them into the output
        route.closest_point_start = gfactory.createPoint(new jsts.geom.Coordinate(route.start_segment.closest_lng, route.start_segment.closest_lat));
        route.closest_point_end   = gfactory.createPoint(new jsts.geom.Coordinate(route.target_segment.closest_lng, route.target_segment.closest_lat));
        route.closest_distance_start = route.start_segment.closest_distance;
        route.closest_distance_end   = route.target_segment.closest_distance;

        // metadata: the sum distance from all the segments, e.g. total trip length
        route.total_meters = route.reduce(function (sum, segment) { return sum + segment.meters; }, 0);

        // and Bob's your uncle
        return route;
    },

    //
    // internal / utility function: given a completed and decorated route from routeDecorate()
    // serialize the sequence of linestrings into a GeoJSON document, ready for consumption
    //
    routeSerialize: function (route) {
        // final prep for hanging back the route
        // massage it into a GeoJSON-shaped structure, so it's ready to consume by almost anything
        var self = this;

        var wktwriter = new jsts.io.GeoJSONWriter();

        var structure = {
            type: "FeatureCollection",
            properties: {
                total_meters: route.total_meters,
                startpoint_wanted: wktwriter.write(route.wanted_start),
                endpoint_wanted: wktwriter.write(route.wanted_end),
                startpoint_trail: wktwriter.write(route.closest_point_start),
                endpoint_trail: wktwriter.write(route.closest_point_end),
                startpoint_meters: route.closest_distance_start,
                endpoint_meters: route.closest_distance_end,
            },
            features: route.map(function (routestep) {
                var feature = wktwriter.write(routestep.geom);

                feature.properties = {
                    id: routestep.id,
                    title: routestep.title,
                    length: routestep.meters,
                    transition: routestep.transition,
                };

                return feature;
            })
        };

        // done!
        return structure;
    }
};
