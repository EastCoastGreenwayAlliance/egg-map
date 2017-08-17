// Redux Action Creators for ECG Routing / Directions
import fetch from 'isomorphic-fetch';

import {
  REQUEST_ROUTING_LOCATION,
  ACCEPT_ROUTING_LOCATION,
  SET_ROUTING_LOCATION,
  CANCEL_ROUTING_LOCATION,
  ROUTING_LOCATION_ERROR,
  ROUTE_SEARCH_REQUEST,
  ROUTE_SEARCH_SUCCESS,
  ROUTE_SEARCH_ERROR,
} from '../common/actionTypes';

import { locationGeocodeClear, elevationDataClear } from './index';

// Requesting the nearest ECG segment node / coordinate
export const nearestSegmentRequest = step => ({
  type: REQUEST_ROUTING_LOCATION,
  step
});

// Errored on locating the nearest ECG segment node / coordinate
export const nearestSegmentError = error => ({
  ROUTING_LOCATION_ERROR,
  error
});

// set the current routing location after a successful request
// @param { array } coords: lat, lng for start location
// @param { string } step: either START or END
export const setRoutingLocation = (coords, distance, step) => ({
  type: SET_ROUTING_LOCATION,
  coords,
  distance,
  step,
});

// fetch action that makes a GET request to route/nearestpoint API endpoint
// see server.js for more info
export const fetchRoutingLocation = (step, lat, lng) => {
  const url = `/route/nearestpoint/?lat=${lat}&lng=${lng}`;

  return (dispatch) => {
    dispatch(nearestSegmentRequest(step));

    return fetch(url)
      .then((res) => {
        if (!res.ok) {
          dispatch(nearestSegmentError(res.statusText));
          throw Error(res.statusText);
        } else {
          return res.json();
        }
      })
      .then((json) => {
        const { closest_lat, closest_lng, closest_distance } = json;
        dispatch(setRoutingLocation([closest_lat, closest_lng], closest_distance, step));
      })
      .catch(error => dispatch(nearestSegmentError(error)));
  };
};

// user accepts / confirms the current routing location
// @param { string } step: either START or END
export const acceptRoutingLocation = step => ({
  type: ACCEPT_ROUTING_LOCATION,
  step
});

// user cancels the current routing location
// @param { string } step: either START, END, or DONE
// this action also fires off other actions to clear the redux store containing
// state for elevation data and geocoding
export const cancelRoutingLocation = step => (dispatch, getState) => {
  dispatch({
    type: CANCEL_ROUTING_LOCATION,
    step,
  });

  const elevationDataPresent = getState().elevation.result;
  if (elevationDataPresent) {
    dispatch(elevationDataClear());
  }

  const geocodeDataPresent = getState().geocoding.result;
  if (geocodeDataPresent) {
    dispatch(locationGeocodeClear());
  }
};

// actions for describing the route search
// happens after a user confirms their start and end locations
// 1. route search was requested, let our app know so we can show a loading GIF
export const routeSearchRequest = () => ({
  type: ROUTE_SEARCH_REQUEST,
});

// 2. route search was successful, pass along the response
// @param { object } response: response returned from ecgClientRouter.findRoute
export const routeSearchSuccess = response => ({
  type: ROUTE_SEARCH_SUCCESS,
  response,
});

// 3. route search errored, pass along the error so it may be handled
// @param { object } error: error returned from ecgClientRouter.findRoute
export const routeSearchError = error => ({
  type: ROUTE_SEARCH_ERROR,
  error,
});

// fetch action that makes a GET request to the route/directions API endpoint
// see server.js for more info
export const fetchRouteDirections = (startLat, startLng, endLat, endLng) => {
  const url = `/route/directions/?slat=${startLat}&slng=${startLng}&tlat=${endLat}&tlng=${endLng}`;

  return (dispatch) => {
    dispatch(routeSearchRequest());
    fetch(url)
      .then((res) => {
        if (!res.ok) {
          dispatch(routeSearchError(res.statusText));
          throw Error(res.statusText);
        } else {
          return res.json();
        }
      })
      .then(json => dispatch(routeSearchSuccess(json)))
      .catch(error => dispatch(routeSearchError(error)));
  };
};
