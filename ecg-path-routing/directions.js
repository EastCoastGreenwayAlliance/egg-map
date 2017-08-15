var jsts = require('jsts');

const DBTABLE_EDGES = require('./sqlfactory').DBTABLE_EDGES;
const sqlQueryFactory = require('./sqlfactory').sqlQueryFactory;
const findNearest = require('./nearestpoint').findNearest;

const DEBUG = false;

const TRANSITION_CODES = {
  RIGHT_TURN: { code: 'RT', text: "Turn right onto " },
  RIGHT_SOFT: { code: 'RS', text: "Bear right onto " },
  RIGHT_HARD: { code: 'RH', text: "Turn sharply right onto " },
  LEFT_TURN:  { code: 'LT', text: "Turn left onto " },
  LEFT_SOFT:  { code: 'LS', text: "Bear left onto " },
  LEFT_HARD:  { code: 'LH', text: "Turn sharply left onto " },
  STRAIGHT:   { code: 'ST', text: "Continue onto " },
  ARRIVE:   { code: 'AR', text: "Arrive" },
  OTHER:    { code: 'XX', text: "" },
};


function findRoute (start_lat, start_lng, target_lat, target_lng, options, success_callback, failure_callback) {
  // is this northbound or southbound? the edges and cues are tagged with N/S/B as a proxy for one-way behavior
  var northbound = start_lat <= target_lat;

  // find the best edges for our starting and ending location
  var pointfinderoptions = {
    direction: northbound ? 'N' : 'S'
  };

  findNearest(start_lat, start_lng, function (start_segment) {
    findNearest(target_lat, target_lng, function (target_segment) {
      if (DEBUG) console.log([ 'start segment', start_lat, start_lng, start_segment ]);
      if (DEBUG) console.log([ 'target segment', target_lat, target_lng, target_segment ]);

      // fetch relevant route segments
      // loading the whole dataset can be workable over a fast connection, but we'd rather not
      // and a bounding box filter to fetch only the relevant area; no path near Boston can be relevant to a route within Florida
      // BUT don't be too draconian, as a 50-mile loop may indeed head well outside the box the the two endpoints (imagine the letter theta)
      var params = {
        n: Math.max(target_segment.n, start_segment.n) + 2.0,
        s: Math.min(target_segment.s, start_segment.s) - 2.0,
        e: Math.max(target_segment.e, start_segment.e) + 2.0,
        w: Math.min(target_segment.w, start_segment.w) - 2.0,
        dir: northbound ? 'N' : 'S'
      };

      // var geomtext = "ST_SIMPLIFY(the_geom,0.0001)"; // a teeny-tiny simplification to clean some of their flourishes that have wonky angles at starts and ends
      var geomtext = "the_geom"; // the geometry is clean enough we can just use it as-is

      var sql = "SELECT pline_id AS id, title, meters, ST_ASTEXT(ST_MULTI(" + geomtext + ")) AS geom FROM " + DBTABLE_EDGES + " WHERE DIRECTION IN ('B', '{{ dir }}') AND the_geom && ST_MAKEENVELOPE({{ w }}, {{ s }}, {{ e }}, {{ n }}, 4326)";

      sqlQueryFactory().execute(sql, params).done(function(data) {
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

          var mypoints     = segment.geom.getCoordinates();
          segment.firstpoint = gfactory.createPoint(mypoints[0]);
          segment.lastpoint  = gfactory.createPoint(mypoints[ mypoints.length-1 ]);

          // done
          return segment;
        });

        // hand off to our path-finder
        // tack on some metadata to the resulting list of segments
        // then pass the results through cleanup and serialization
        if (DEBUG) console.log('downloaded ' + data.rows.length + ' segments, starting assembly');

        try {
          var route = assemblePath(start_segment, target_segment, data.rows, northbound);

          if (! route) { failure_callback("Please try a shorter route."); return; }

          route.start_lat    = start_lat;
          route.start_lng    = start_lng;
          route.target_lat   = target_lat;
          route.target_lng   = target_lng;
          route.start_segment  = start_segment;
          route.target_segment = target_segment;

          // hand off to various postprocess and cleanup steps
          route = routeCleanup(route);
          route = routeClipStartEndSegments(route);

          // metadata: the sum distance from all the segments, e.g. total trip length
          route.total_meters = route.reduce(function (sum, segment) { return sum + segment.meters; }, 0);

          route = routeDownsample(route);
          route = routeSerialize(route);

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
    },
    pointfinderoptions
    )
  },
  function (errmsg) {
    failure_callback("error finding start segment: " + errmsg);
  },
  pointfinderoptions
  );
}
exports.findRoute = findRoute;




//
// internal functions used to generate and to clean up that route
//

function assemblePath (start_segment, target_segment, universe_segments, northbound) {
  // Point.clone() does not work, thus the use of gfactory
  var gfactory = new jsts.geom.GeometryFactory();

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

  // segment-flip our starting segment route[0]
  // so its lastpoint (our current location along the path, so to speak) is the endpoint closer to our goal
  // 50% of the time this makes a faster route by heading the right way on the first step
  var d1 = route[0].firstpoint.distance(target_geom.centroid);
  var d2 = route[0].lastpoint.distance(target_geom.centroid);
  if (d1 < d2) {
    route[0].geom.geometries[0].points.coordinates.reverse();

    var thispoints    = route[0].geom.getCoordinates();
    route[0].firstpoint = gfactory.createPoint(thispoints[0]);
    route[0].lastpoint  = gfactory.createPoint(thispoints[ thispoints.length-1 ]);
  }

  // if we fail our way back to start, remember that our starting segment has two ends and we should try the other end
  var already_flipped_start = false;

  // the big loop
  // starting at our latest segment, find all other segments which touch it (more or less) and they are candidates for our next step
  // unless they've been poisoned (tagged as backward)
  while (true) {
    var here = route[ route.length-1 ];
    if (here.id == target_segment.id) if (DEBUG) console.log([ "arrived", here.debug ]);
    if (here.id == target_segment.id) break; // we're there! done!

    if (DEBUG) console.log([ "current location:", here.debug, here.lastpoint ]);
    var candidates = universe_segments.filter(function (candidate) {
      // use this to debug if two segments aren't connecting but you think they should
      // compare their endpoint-to-endpoint distance to the tolerance below
      // tip: if the end-to-end distance is greater than the minimum distance, maybe the ends you see aren't really the ends, e.g. the line bends back over itself
      var tolerance = 0.001; // about 50ft; the topology is bad but we should tolerate it

      /*
      if (here.id == 661596 && candidate.id == 661598) {
        if (DEBUG) console.log([ 'minimum distance between segments', here.geom.distance(candidate.geom) ]);
        if (DEBUG) console.log([ 'distance to next segment first endpoint', here.lastpoint.distance(candidate.firstpoint), here.geom.distance(candidate.firstpoint) <= tolerance ]);
        if (DEBUG) console.log([ 'distance to next segment last endpoint', here.lastpoint.distance(candidate.lastpoint), here.geom.distance(candidate.lastpoint) <= tolerance ]);
      }
      */

      if (poisoned[candidate.id]) return false;

      return here.lastpoint.distance(candidate.firstpoint) <= tolerance || here.lastpoint.distance(candidate.lastpoint) <= tolerance;
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
      if (DEBUG) console.log([ "fork detected here:", here.debug, 'candidates are:', candidates ]);
      here.fork = true;

      // Manhattan heuristic: whichever candidate is closer to our destination, is probably right
      candidates.sort(function (p, q) {
        return p.centroid.distance(target_geom.centroid) <  q.centroid.distance(target_geom.centroid) ? -1 : 1;
      });
      nextsegment = candidates[0];
    }
    else if (route.length == 1) {
      // we're at our starting segment and have no candidates
      // try flipping the starting segment's vertices so we start at the other end of the segment, see if we get better fortune that way
      // if we already tried that (fork=false) then we've exhausted both ends of the starting segment, and it's time to give up
      if (! already_flipped_start) {
        if (DEBUG) console.log([ "zero candidates at starting node. try flipping" ]);
        here.geom.geometries[0].points.coordinates.reverse();

        var thispoints  = here.geom.getCoordinates();
        here.firstpoint = gfactory.createPoint(thispoints[0]);
        here.lastpoint  = gfactory.createPoint(thispoints[ thispoints.length-1 ]);

        already_flipped_start = true;
      }
      else {
        if (DEBUG) console.log([ "zero candidates at starting node even after flipping. there is no path" ]);
        route = null;
      }
    }
    else {
      // no candidates at all? then we're at a dead end, but not at our beginning
      if (DEBUG) console.log([ 'dead end at:', here.debug ]);

      // this is not a fork if we have 0 candidates
      here.fork = false;

      // find the last node in our route which is a fork
      // strip off the remainder of the route
      // then let nextsegment remain null, so our next pass will be on that fork node with one less option
      for (var i=route.length-1 ; i >= 0; i--) {
        if (i > 0 && ! route[i].fork) continue;
        if (DEBUG) console.log([ "last fork was at step:", i, route[i].debug ]);
        route.splice(i+1);
        if (DEBUG) console.log([ 'stripped back to last fork:', route[route.length-1].debug ]);
        break;
      }
    }

    // the only way that route can become null is by giving up entirely (it's an array with at least the 1 starting segment)
    if (route === null) break;

    // add this segment to our route
    // involves a few steps...
    if (nextsegment) {
      // flip this next segment's vertices so we're sure we have an end-to-end trail, a consistent set of vertices in sequence
      // and thus the last coordinate of our last step of our route, is basically "our location" as far as we have progressed
      // this doesn't make a difference if just drawing the lines' shapes onto a map, but matters a lot when figuring out turning, elevation profiles, etc.
      // segment flipping -- align each step's ending vertex to the next line's starting vertex
      // this makes the vertices truly sequential along the route, which is relevant to:
      // - generating elevation profile charts, as one would want the elevations in sequence
      // - filling in gaps, by fudging the starting and ending points so they have the same vertex
      // - generating turning directions, where one line makes a transition into the next
      var dx11 = here.firstpoint.distance(nextsegment.firstpoint);
      var dx22 = here.lastpoint.distance(nextsegment.lastpoint);
      var dx12 = here.firstpoint.distance(nextsegment.lastpoint);
      var dx21 = here.lastpoint.distance(nextsegment.firstpoint);
      switch (Math.min(dx11, dx12, dx22, dx21)) {
        case dx21:
          // this segment's end meets the next segment's start; great!
          if (DEBUG) console.log([ 'segment end align', here.debug, nextsegment.debug, 'ok as is' ]);
          break;
        case dx11:
          // this segment's start meets the next segment's start; flip this one
          if (DEBUG) console.log([ 'segment end align', here.debug, nextsegment.debug, 'flip here' ]);

          here.geom.geometries[0].points.coordinates.reverse();

          var thispoints  = here.geom.getCoordinates();
          here.firstpoint = gfactory.createPoint(thispoints[0]);
          here.lastpoint  = gfactory.createPoint(thispoints[ thispoints.length-1 ]);

          break;
        case dx12:
          // this segment's start meets the next segment's end; flip both
          if (DEBUG) console.log([ 'segment end align', here.debug, nextsegment.debug, 'flip both' ]);

          here.geom.geometries[0].points.coordinates.reverse();
          nextsegment.geom.geometries[0].points.coordinates.reverse();

          var thispoints  = here.geom.getCoordinates();
          here.firstpoint = gfactory.createPoint(thispoints[0]);
          here.lastpoint  = gfactory.createPoint(thispoints[ thispoints.length-1 ]);

          var nextpoints     = nextsegment.geom.getCoordinates();
          nextsegment.firstpoint = gfactory.createPoint(nextpoints[0]);
          nextsegment.lastpoint  = gfactory.createPoint(nextpoints[ nextpoints.length-1 ]);

          break;
        case dx22:
          // this segment's end meets the next segment's end; flip next one
          if (DEBUG) console.log([ 'segment end align', here.debug, nextsegment.debug, 'flip next' ]);

          nextsegment.geom.geometries[0].points.coordinates.reverse();

          var nextpoints     = nextsegment.geom.getCoordinates();
          nextsegment.firstpoint = gfactory.createPoint(nextpoints[0]);
          nextsegment.lastpoint  = gfactory.createPoint(nextpoints[ nextpoints.length-1 ]);

          break;
      }

      // add this segment to our route
      // and poison this segment so we won't try it again (backward is never a way forward)
      poisoned[ nextsegment.id ] = true;
      route.push(nextsegment);
    }
  } // end of potentially infinite loop

  // done assembling the path; or else a null because there is no path
  // hand back to caller, probably for postprocessing
  return route;
};

//
// flip segments end-to-end so they have a consistent sequence
// give each segment a "transition" object describing the turn and the transition
//
function routeCleanup (route) {
  // tip: Point.clone() does not work, thus the use of gfactory
  // also to compose new point objects based on route metadata
  var gfactory = new jsts.geom.GeometryFactory();

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
    if (DEBUG) console.log([ 'patching gap', thisstep.debug, nextstep.debug, newpoint ]);
    thisstep.geom.geometries[0].points.coordinates.push(newpoint.coordinates.coordinates[0]);
    thisstep.lastpoint = newpoint;
  }

  // go through the transitions and generate a directions attribute by comparing the azimuth of the old path and the new path
  // - human directions with the name "Turn right onto Schermerhorn Ct"
  // - simplified directions fitting a domain "R"
  // - latlong of this step-segment's lastpoint vertex for the location of this transition
  //
  // add to the final point a transition as well, so caller doesn't need to scramble with "if not segment.transition"

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
    if (DEBUG) console.log([ 'turning', thisstep.debug, nextstep.debug, thisaz, nextaz, angle ]);

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
  // they already have these from findNearest() but let's formalize them into the output
  route.closest_point_start = gfactory.createPoint(new jsts.geom.Coordinate(route.start_segment.closest_lng, route.start_segment.closest_lat));
  route.closest_point_end   = gfactory.createPoint(new jsts.geom.Coordinate(route.target_segment.closest_lng, route.target_segment.closest_lat));
  route.closest_distance_start = route.start_segment.closest_distance;
  route.closest_distance_end   = route.target_segment.closest_distance;

  // and Bob's your uncle
  return route;
};

// given a completed path from assemblePath() do trim the starty and end segments
// to fit the requested start and end points, rather than including the extra segment content before and after we'd rather be getting on/off the road
function routeClipStartEndSegments (route) {
  var gfactory = new jsts.geom.GeometryFactory();

  //
  // starting segment
  //

  // iterate over vertices, find the closest vertex to our start latlng
  // rewrite the segment geometry to start at that point: clip vertices, rewrite segment.startpoint, recalculate length of segment
  var start_segment  = route[0];
  var start_vertices = start_segment.geom.geometries[0].points;

  var start_mindist = 999999;
  var start_closest_index;
  for (var i = 0; i < start_vertices.coordinates.length; i++) {
    var thispoint = gfactory.createPoint(start_vertices.coordinates[i]);
    var thisdist = thispoint.distance(route.closest_point_start);

    if (DEBUG) console.log([ 'start segment find closest', start_segment, i, thispoint, thisdist ]);

    if (thisdist < start_mindist) {
      start_closest_index = i;
      start_mindist = thisdist;
    }
  }
  if (DEBUG) console.log(['start segment trim, closest is', start_closest_index, 'out of', start_vertices.coordinates.length - 1 ]);

  // if segment 0 happens to have been the closest, then we're already fine
  // otherwise, slice our vertex list and prepend our start latlng as being the new first vertex
  // then recalculate the length of the newly-truncated segment
  if (start_closest_index > 0) {
    if (DEBUG) console.log(['start segment before=', route[0].firstpoint, route[0].geom ]);
    var newvertices = start_vertices.coordinates.slice(start_closest_index);
    newvertices.unshift(route.closest_point_start.coordinates.coordinates[0]);

    route[0].geom = gfactory.createMultiLineString([ gfactory.createLineString(newvertices) ]);
    route[0].firstpoint = route.closest_point_start;

    route[0].meters = 0;
    for (var i=1, l=newvertices.length-1; i<=l; i++) {
      var thisone = newvertices[i];
      var prevone = newvertices[i-1];
      route[0].meters += getLatLonPairDistance(thisone.y, thisone.x, prevone.y, prevone.x);
    }

    if (DEBUG) console.log(['start segment after=', route[0].firstpoint, route[0].geom ]);
  }

  //
  // ending / target segment
  //

  // iterate over vertices, find the closest vertex to our target latlng
  // rewrite the segment geometry to target at that point: clip vertices, rewrite segment.targetpoint, recalculate length of segment
  var target_segment  = route[ route.length - 1 ];
  var target_vertices = target_segment.geom.geometries[0].points;

  var target_mindist = 999999;
  var target_closest_index;
  for (var i = 0; i < target_vertices.coordinates.length; i++) {
    var thispoint = gfactory.createPoint(target_vertices.coordinates[i]);
    var thisdist = thispoint.distance(route.closest_point_end);

    if (DEBUG) console.log([ 'target segment find closest', target_segment, i, thispoint, thisdist ]);

    if (thisdist < target_mindist) {
      target_closest_index = i;
      target_mindist = thisdist;
    }
  }
  if (DEBUG) console.log(['target segment trim, closest is', target_closest_index, 'out of', target_vertices.coordinates.length - 1 ]);

  // if segment -1 happens to have been the closest, then we're already fine
  // otherwise, slice our vertex list and prepend our target latlng as being the new first vertex
  // then recalculate the length of the newly-truncated segment
  if (target_closest_index < target_vertices.coordinates.length - 1) {
    if (DEBUG) console.log(['target segment before=', route[ route.length - 1 ].firstpoint, route[ route.length - 1 ].geom ]);
    var newvertices = target_vertices.coordinates.slice(0, target_closest_index + 1);
    newvertices.push(route.closest_point_end.coordinates.coordinates[0]);

    route[ route.length - 1 ].geom = gfactory.createMultiLineString([ gfactory.createLineString(newvertices) ]);
    route[ route.length - 1 ].lastpoint = route.closest_point_end;
    route[ route.length - 1 ].transition.lat = route.closest_point_end.coordinates.coordinates[0].y;
    route[ route.length - 1 ].transition.lng = route.closest_point_end.coordinates.coordinates[0].x;

    route[ route.length - 1 ].meters = 0;
    for (var i=1, l=newvertices.length-1; i<=l; i++) {
      var thisone = newvertices[i];
      var prevone = newvertices[i-1];
      route[ route.length - 1 ].meters += getLatLonPairDistance(thisone.y, thisone.x, prevone.y, prevone.x);
    }

    if (DEBUG) console.log(['target segment after=', route[ route.length - 1 ].firstpoint, route[ route.length - 1 ].geom ]);
  }

  // done, hand it back
  return route;
};

// create a "downsampled" version of the route suitable for an elevation profile
// 15,000 vertices is more than any API will accept, and also means a 15000px-wide chart which would be silly
// pick out X number of vertices spaced more-or-less evenly over the route, and those would be used by the caller for elevation profiles or the like
//
// return is the same route object, now decorated with a .downsampled property
// this is an array of coordinate objects, each of which has .lat and .lng properties
function routeDownsample (route) {
  var howmanysamples = 400;
  route.downsampled = [];

  // compile the straight list of vertices from all steps
  // return is an array of JSTS Coordinate objects, so we can use .distance() to generate a balanced sample
  // later on, we'll translate these into simple lat-lng objects for the caller
  var allvertices = [].concat.apply([],
    route.map(function (thisstep) {
      return thisstep.geom.geometries[0].points.coordinates;
    })
  );
  if (DEBUG) console.log([ 'downsample collected vertices', allvertices ]);

  // what we want is a sample evenly-balanced along the .total_meters of the whole route
  var meters_between_samples = Math.round(route.total_meters / howmanysamples);
  if (DEBUG) console.log([ 'downsample total/points/interval', route.total_meters, howmanysamples, meters_between_samples ]);

  var total_distance_traveled = 0;
  var accumulated_sample_distance = 0;
  for (var i=1, l=allvertices.length-1; i<=l; i++) {
    var thisone = allvertices[i];
    var prevone = allvertices[i-1];
    var thisdistance = getLatLonPairDistance(thisone.y, thisone.x, prevone.y, prevone.x);

    total_distance_traveled += thisdistance;  // log the total distance we have come; sample points are saved with this as their X axis in miles

    accumulated_sample_distance += thisdistance;
    if (accumulated_sample_distance >= meters_between_samples) {
      thisone.miles = total_distance_traveled / 1609;
      route.downsampled.push(thisone);
      accumulated_sample_distance = 0;
      // if (DEBUG) console.log([ 'downsample using this vertex', thisone ]);
    }
  }

  // convert those coordinates back to proper Point objects so they can be serialized later; right now they're raw Coordinate items
  // add to them some easy-access attributes which will be used by callers, in postprocessing, in serialization, ...
  var gfactory = new jsts.geom.GeometryFactory();
  route.downsampled = route.downsampled.map(function (samplepoint) {
    var pointobject   = gfactory.createPoint(samplepoint);
    pointobject.lat   = samplepoint.y;
    pointobject.lng   = samplepoint.x;
    pointobject.miles = samplepoint.miles;
    return pointobject;
  });

  // all set, hand back the modified route object
  if (DEBUG) console.log([ 'downsample done: ', route.downsampled ]);
  return route;
};

// internal / utility function: given a completed and decorated route from routeCleanup()
// serialize the sequence of linestrings into a GeoJSON document, ready for consumption
function routeSerialize (route) {
  // final prep for hanging back the route
  // massage it into a GeoJSON-shaped structure, so it's ready to consume by almost anything
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
    downsampled: route.downsampled.map(function (samplepoint) {
      var feature = wktwriter.write(samplepoint);
      feature.properties = {
        lat: parseFloat(samplepoint.lat.toFixed(5)),
        lng: parseFloat(samplepoint.lng.toFixed(5)),
        miles: parseFloat(samplepoint.miles.toFixed(2)),
      };
      return feature;
    }),
    features: route.map(function (routestep) {
      var feature = wktwriter.write(routestep.geom);
      return {
        geometry: {
          type: feature.type,
          coordinates: feature.coordinates
        },
        properties: {
          id: routestep.id,
          title: routestep.title,
          length: routestep.meters,
          transition: routestep.transition,
        },
        type: "Feature",
      };
    }),
  };

  // done!
  return structure;
};


//
// math utilities
//

// the Haversine formula to find distance (in meters) between two lat-lon pairs -- why is this not in JSTS?
function getLatLonPairDistance (lat1, lon1, lat2, lon2) {
  var R = 6371;
  var dLat = deg2rad(lat2-lat1);
  var dLon = deg2rad(lon2-lon1);
  var a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *  Math.sin(dLon/2) * Math.sin(dLon/2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  var d = R * c * 1000; // Distance in meters
  return d;
}

function rad2deg (angle) {
  return angle * 57.29577951308232; // angle / Math.PI * 180
}

function deg2rad (angle) {
  return angle * 0.017453292519943295; // (angle / 180) * Math.PI;
}
