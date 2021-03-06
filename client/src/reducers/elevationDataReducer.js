import {
  ELEVATION_DATA_REQUEST,
  ELEVATION_DATA_SUCCESS,
  ELEVATION_DATA_ERROR,
  ELEVATION_DATA_CLEAR,
} from '../common/actionTypes';

const defaultState = {
  isFetching: false,
  result: null,
  error: null,
};

export default (state = defaultState, action) => {
  switch (action.type) {
    case ELEVATION_DATA_REQUEST:
      return {
        ...state,
        isFetching: true,
      };

    case ELEVATION_DATA_SUCCESS:
      return {
        ...state,
        isFetching: false,
        result: action.json,
      };

    case ELEVATION_DATA_ERROR:
      return {
        ...state,
        isFetching: false,
        error: action.error
      };

    case ELEVATION_DATA_CLEAR:
      return defaultState;

    default:
      return state;
  }
};
