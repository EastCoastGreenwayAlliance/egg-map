// Connects the part of the application state with the SearchInput component
// see http://redux.js.org/docs/basics/UsageWithReact.html
import { connect } from 'react-redux';

import SearchInput from '../components/SearchBox/SearchInput';
import {
  fetchLocationGeocode,
  setRoutingLocation,
  acceptRoutingLocation,
  cancelRoutingLocation,
} from '../actions/';

const mapStateToProps = ({ routing }) => {
  const { startLocation, endLocation, route } = routing;
  const { isLoadingRoute } = route;
  return {
    startLocation,
    endLocation,
    isLoadingRoute,
  };
};

/** Connects the SearchBox to the Redux store & action creator functions */
export default connect(mapStateToProps, {
  fetchLocationGeocode,
  setRoutingLocation,
  acceptRoutingLocation,
  cancelRoutingLocation,
})(SearchInput);
