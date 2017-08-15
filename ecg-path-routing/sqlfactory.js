// abstract out the seemingly-simmple "new cartodb.sql"
// since we correct for CARTO's library having the wrong URL to CARTO services
// and doing this EVERYWHERE is silly

var cartodb = require('cartodb');

const CARTODB_USER = 'niles';
const DBTABLE_EDGES = "ecg_route_lines_prod";

function sqlQueryFactory () {
  return new cartodb.SQL({
    user: CARTODB_USER,
    sql_api_url: 'https://niles.carto.com/api/v2/sql',
  });
}

exports.sqlQueryFactory = sqlQueryFactory;
exports.CARTODB_USER = CARTODB_USER;
exports.DBTABLE_EDGES = DBTABLE_EDGES;
