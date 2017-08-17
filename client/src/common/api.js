import queryString from 'query-string';

import { cartoUser, routeSegmentsFieldsVisible } from './config';
import cartocss from './cartocss';
import { defaultRoutingState } from '../reducers';

// App "API" functionality & logic stored in this module
const isNumber = val => val && typeof val === 'number';

// helper function to convert meters to miles
// arguments: value to convert (number), decimal precision of number returned (integer)
export const metersToMiles = (x, p) => +parseFloat(x * 0.000621371).toFixed(p || 2);

// parse URL query params for use with hydrating Redux state on app load
export const parseQueryParams = () => {
  const search = window.location.search;
  if (!search.length) return {};

  // parse a string like '?thing1=x&thing2=y&thing3=z' into an object
  const parsed = queryString.parse(search);
  const keys = Object.keys(parsed);

  // if keys aren't valid, don't do anything else
  if (keys.indexOf('loc') === -1 && keys.indexOf('route') === -1) return {};

  // check for location & route keys, parse them as well if present
  keys.forEach((key) => {
    if (key === 'loc' && parsed.loc) {
      parsed.loc = parsed.loc.split(',').map(n => parseFloat(n));

      if (parsed.loc.length) {
        parsed.loc.map((n) => {
          if (isNumber(n)) return n;
          return null;
        });
      }
    }

    if (key === 'route' && parsed.route) {
      parsed.route = parsed.route.split(',').map(n => parseFloat(n));

      if (parsed.route.length) {
        parsed.route.map((n) => {
          if (isNumber(n)) return n;
          return null;
        });
      }
    }
  });

  return parsed;
};

// grab the map zoom, lat, lon from query params
export const queryZXY = () => {
  const parsed = parseQueryParams();

  if (parsed.loc && parsed.loc.length === 3) {
    return {
      zoom: parsed.loc[0],
      lat: parsed.loc[1],
      lng: parsed.loc[2]
    };
  }

  return {};
};

// grab the start and/or end coordinates for a previously searched route
export const queryStartEnd = () => {
  const parsed = parseQueryParams();

  if (parsed.route && parsed.route.length === 2) {
    return {
      start: parsed.route
    };
  }

  if (parsed.route && parsed.route.length === 4) {
    return {
      start: parsed.route.slice(0, 2),
      end: parsed.route.slice(2, 4)
    };
  }

  return {};
};

// sets the application state for (geo)routing from parsed URL query params
export const preloadRoutingState = () => {
  const startEnd = queryStartEnd();

  return {
    ...defaultRoutingState,
    startLocation: {
      ...defaultRoutingState.startLocation,
      accepted: typeof startEnd.start !== 'undefined',
      coordinates: startEnd.start || [],
    },
    endLocation: {
      ...defaultRoutingState.endLocation,
      accepted: typeof startEnd.end !== 'undefined',
      coordinates: startEnd.end || [],
    }
  };
};

// CARTO layer source object for use with carto(db).js
export const cartoLayerSource = {
  user_name: cartoUser,
  type: 'cartodb',
  sublayers: [{
    sql: '',
    cartocss,
    interactivity: routeSegmentsFieldsVisible.join(',')
  }]
};

// enables the SQL to be changed for the Carto(db).JS layer source object
export const configureLayerSource = (sql) => {
  cartoLayerSource.sublayers[0].sql = sql;
  return cartoLayerSource;
};

// CARTO SQL API endpoint
export const cartoSQLQuery = query =>
  `https://${cartoUser}.carto.com/api/v2/sql?q=${query}`;

// async loads togpx.js
export const loadToGPX = callback =>
  import('togpx')
    .then(response => callback(null, response))
    .catch(error => callback(error));

// async loads file-saver.js
export const loadFileSaver = callback =>
  import('file-saver')
    .then(response => callback(null, response))
    .catch(error => callback(error));
