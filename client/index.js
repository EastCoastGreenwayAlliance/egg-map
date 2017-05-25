var CARTODB_USER = 'greeninfo';

var DBTABLE_EDGES = "ecglines_clean_unique";

$(window).on('load', function () {
    //
    // fetch the routing dataset and load it into memory
    // we'll use this for route-finding
    //

    // 7th and Townsend St -> Drigger Blvd, near Darien, GA
    /*
    ROUTER.findRoute(31.1811, -81.4993, 31.2795, -81.4393, function (results) {
    }, function (errormessage) {
    });
    */

    // 7th and Townsend St -> 2nd St in Darien, GA   jumps a break in the cue points as they are not used
    ROUTER.findRoute(31.1811, -81.4993, 31.3640, -81.4193, function (route) {
        var $readout = $('#directions').empty();
        route.forEach(function (routestep) {
            $("<li></li>").text(routestep.debug).appendTo($readout);
        });
    }, function (errormessage) {
        alert(errormessage);
    });
});

var ROUTER = {
    // main entry point
    // start lat, start lng, end lat, end lng
    findRoute: function (start_lat, start_lng, target_lat, target_lng, success_callback, failure_callback) {
        var myself = this;

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
                var params = {
                    n: Math.max(target_edge.n, start_edge.n) + 0.2,
                    s: Math.min(target_edge.s, start_edge.s) - 0.2,
                    e: Math.max(target_edge.e, start_edge.e) + 0.2,
                    w: Math.min(target_edge.w, start_edge.w) - 0.2,
                    dir: northbound ? 'N' : 'S'
                };
                db.execute("SELECT pline_id AS id, title, ST_ASTEXT(the_geom) AS geom FROM " + DBTABLE_EDGES + " WHERE DIRECTION IN ('B', '{{ dir }}') AND the_geom && ST_MAKEENVELOPE({{ w }}, {{ s }}, {{ e }}, {{ n }}, 4326)", params)
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
                        segment.geom = wktreader.read(segment.geom);

                        var mypoints       = segment.geom.getCoordinates();
                        segment.firstpoint = gfactory.createPoint(mypoints[0]);
                        segment.lastpoint  = gfactory.createPoint(mypoints[ mypoints.length-1 ]);

                        segment.firstpointsnap = segment.firstpoint.buffer(0.002, 10); // about 50ft
                        segment.lastpointsnap  = segment.lastpoint.buffer(0.002, 10);  // about 50ft

                        // done
                        return segment;
                    });

                    // hand off to our path-finder
                    // give the results back to our callback
                    try {
                        var route = myself.assemblePath(start_edge, target_edge, data.rows, northbound);
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
        // a list of edges which we have determined are wrong: wrong forks, wrong direction
        var poisoned = {};

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
                // if we were wrong we'd eventually end up with 0 candidates and not at the end, and backtrack to the fork
                console.log([ "fork detected here:", here.debug, 'candidates are:', candidates ]);
                here.fork = true;
                nextsegment = candidates[0];
            }
            else {
                // no candidates at all? then we're at a dead end and it's not our destination
                here.fork = false;

                // find the last node in our route which is a fork
                // strip off the remainder of the route
                // then let nextsegment remain null, so our next pass will be on that fork node with one less option
                console.log([ 'dead end at:', here.debug ]);
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

        // done! hand it back to the caller
        return route;
    },
    findDistance: function () {
    },
};
