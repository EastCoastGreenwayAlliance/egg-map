// Connects parts of the application state with the SearchResults component
// see http://redux.js.org/docs/basics/UsageWithReact.html
import { connect } from 'react-redux';

import SearchResults from '../components/SearchBox/SearchResults';
import {
  nearestSegmentRequest,
  nearestSegmentError,
  setRoutingLocation,
  acceptRoutingLocation,
  cancelRoutingLocation,
  routeSearchRequest,
  routeSearchSuccess,
  routeSearchError,
  fetchRoutingLocation,
} from '../actions';

const mapStateToProps = ({ browser, geocoding, routing }) => {
  const { error, result, isFetching } = geocoding;
  const { endLocation, startLocation, route } = routing;
  const { greaterThan } = browser;

  return {
    geocodeIsFetching: isFetching,
    geocodeError: error,
    geocodeResult: result,
    isMobile: !greaterThan.medium,
    endLocation,
    startLocation,
    route
  };
};

export default connect(mapStateToProps, {
  nearestSegmentRequest,
  nearestSegmentError,
  setRoutingLocation,
  acceptRoutingLocation,
  cancelRoutingLocation,
  routeSearchRequest,
  routeSearchSuccess,
  routeSearchError,
  fetchRoutingLocation,
})(SearchResults);
