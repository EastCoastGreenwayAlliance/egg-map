const DBTABLE_EDGES = require('./sqlfactory').DBTABLE_EDGES;
const sqlQueryFactory = require('./sqlfactory').sqlQueryFactory;


function findNearest (lat, lng, options, callback) {
  var closest_segment;

  var directionclause = "TRUE";
  switch (options && options.direction) {
    case 'N': // N trails only
      directionclause = "direction IN ('B', 'N')"
      break;
    case 'S': // S trails only
      directionclause = "direction IN ('B', 'S')"
      break;
    default: // undefined, null, etc. do not filter by directionality
      break;
  }

  var trailtypeclause = "TRUE";
  if (options && options.trailonly) {
    trailtypeclause = "line_type NOT IN ('Transit or Ferry')";
  }

  var sql = "SELECT pline_id AS id, title, ST_DISTANCE(the_geom::geography, ST_SETSRID(ST_MAKEPOINT({{ lng }}, {{ lat }}), 4326)::geography) AS closest_distance, ST_Y(ST_CLOSESTPOINT(the_geom, ST_SETSRID(ST_MAKEPOINT({{ lng }}, {{ lat }}), 4326))) AS closest_lat, ST_X(ST_CLOSESTPOINT(the_geom, ST_SETSRID(ST_MAKEPOINT({{ lng }}, {{ lat }}), 4326))) AS closest_lng, ST_XMAX(the_geom) AS e, ST_XMIN(the_geom) AS w, ST_YMIN(the_geom) AS s, ST_YMAX(the_geom) AS n FROM " + DBTABLE_EDGES + " WHERE " + directionclause + " AND " + trailtypeclause + " ORDER BY the_geom <-> ST_SETSRID(ST_MAKEPOINT({{ lng }}, {{ lat }}), 4326) LIMIT 1";
  var params = { lng: lng, lat: lat };

  sqlQueryFactory().execute(sql, params).done(function(data) {
    closest_segment = data.rows[0];

    closest_segment.wanted_lat = lat; // decorate with the actually-requested lat+lng
    closest_segment.wanted_lng = lng; // decorate with the actually-requested lat+lng

    if (callback && typeof callback === 'function') {
      callback(null, closest_segment);
    }
  })
  .error(function(errors) {
    var errmsg = "findNearest failed: " + errors[0];

    if (callback && typeof callback === 'function') {
      callback(errmsg);
    }
  });
};

exports.findNearest = findNearest;
