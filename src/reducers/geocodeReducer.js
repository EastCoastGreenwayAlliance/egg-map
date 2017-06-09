// Redux Reducer that handles making a request to the Google Geocoder API
import {
  LOCATION_GEOCODE_REQUEST,
  LOCATION_GEOCODE_SUCESS,
  LOCATION_GEOCODE_ERROR
} from '../common/actionTypes';

const defaultState = {
  isFetching: false,
  searchTerm: '',
  result: null,
  error: null
};

export default (state = defaultState, action) => {
  switch (action.type) {
    case LOCATION_GEOCODE_REQUEST:
      return {
        ...state,
        isFetching: true,
        searchTerm: action.searchTerm
      };

    case LOCATION_GEOCODE_SUCESS:
      return {
        ...state,
        isFetching: false,
        result: action.json
      };

    case LOCATION_GEOCODE_ERROR:
      return {
        ...state,
        isFetching: false,
        error: action.error
      };

    default:
      return state;
  }
};