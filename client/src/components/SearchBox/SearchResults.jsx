import React, { Component } from 'react';
import PropTypes from 'prop-types';
import isEqual from 'lodash/isEqual';

import { logRouteSearchTime } from '../../common/googleAnalytics';

// helper components
import LoadingMsg from '../LoadingMsg';
import ErrorMsg from '../ErrorMsg';
import StartLocationOptions from './StartLocationOptions';
import EndLocationOptions from './EndLocationOptions';
import EndLocationAcceptedOptions from './EndLocationAcceptedOptions';

/** Class that handles:
  - logic for selecting a portion of the ECG route
  - displaying location search results
  - displaying geo-routing results */
class SearchResults extends Component {
  static propTypes = {
    nearestSegmentRequest: PropTypes.func.isRequired,
    nearestSegmentError: PropTypes.func.isRequired,
    setRoutingLocation: PropTypes.func.isRequired,
    acceptRoutingLocation: PropTypes.func.isRequired,
    cancelRoutingLocation: PropTypes.func.isRequired,
    routeSearchRequest: PropTypes.func.isRequired,
    routeSearchSuccess: PropTypes.func.isRequired,
    routeSearchError: PropTypes.func.isRequired,
    fetchRoutingLocation: PropTypes.func.isRequired,
    fetchRouteDirections: PropTypes.func.isRequired,
    geocodeIsFetching: PropTypes.bool,
    geocodeError: PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.object
    ]),
    geocodeResult: PropTypes.object,
    isMobile: PropTypes.bool.isRequired,
    startLocation: PropTypes.object,
    endLocation: PropTypes.object,
    route: PropTypes.object,
  }

  constructor() {
    super();
    // Placeholder for the geo routing module
    // Note that it's not imported immediately due to its dependency, JSTS, being a large file size
    // instead we load it async after the user performs a search
    // see Webpack documenation for more info: https://webpack.js.org/guides/code-splitting-async/
    this.geoRouter = undefined;
    // for logging the amount of time it takes to search for a route
    this.routeSearchStartTime = null;
    this.routeSearchEndTime = null;
  }

  componentWillMount() {
    const { startLocation, endLocation } = this.props;

    // check for preloaded state with start and end locations, if they exist tell
    // the geoRouter to find a route between them asyc
    if (endLocation.accepted && endLocation.coordinates.length && startLocation.accepted
      && startLocation.coordinates.length) {
      this.routeSearchStartTime = new Date();
      this.getRoute(startLocation, endLocation);
    }
  }

  componentWillReceiveProps(nextProps) {
    const { geocodeResult, startLocation, endLocation, route } = nextProps;

    if (geocodeResult && !isEqual(geocodeResult, this.props.geocodeResult)) {
      // We received a geocode result from the user, so show the geocode result
      // and nearest ECG route segment node
      this.handleGeocodeResult(geocodeResult);
    }

    // user has okay'd start and end locations, now get the actual route
    if (startLocation.accepted && endLocation.accepted && !this.props.endLocation.accepted) {
      // note the start time before the route search took place
      this.routeSearchStartTime = new Date();
      // fire the geo router findRoute method
      this.getRoute(startLocation, endLocation);
    }

    // we recieved the route response, log the amount of time it took to find the route
    if (route.response && !this.props.route.response) {
      this.routeSearchEndTime = new Date();
      const timeEllapsed = this.routeSearchEndTime.getTime() - this.routeSearchStartTime.getTime();
      logRouteSearchTime(timeEllapsed);
      this.routeSearchStartTime = null;
      this.routeSearchEndTime = null;
    }
  }

  getRoute(startLocation, endLocation) {
    // handles making the geo routing search request given start and end locations
    const { fetchRouteDirections } = this.props;
    fetchRouteDirections(
      startLocation.coordinates[0],
      startLocation.coordinates[1],
      endLocation.coordinates[0],
      endLocation.coordinates[1],
    );
  }

  handleGeocodeResult(result) {
    const { coordinates } = result;
    const { startLocation, endLocation, fetchRoutingLocation } = this.props;

    if (!coordinates || !coordinates.length) return;

    // if no start location has been set then get the nearest ECG segment,
    // and we'll call that the start location
    if (!startLocation.accepted && !endLocation.accepted) {
      const lat = coordinates[0];
      const lng = coordinates[1];
      // get the nearest ecg segment location to the geocode result
      fetchRoutingLocation('START', lat, lng);
    }

    // if we have a start location and not an end location, get the nearest ECG segment
    // and we'll call that the end location
    if (startLocation.accepted && !endLocation.accepted) {
      const lat = coordinates[0];
      const lng = coordinates[1];
      // get the nearest ecg segment location to the geocode result
      fetchRoutingLocation('END', lat, lng);
    }
  }

  renderSearchResultsStep() {
    // handles which step of the Search UX Flow to display using application state
    const { geocodeError, geocodeResult, geocodeIsFetching, isMobile, startLocation,
      endLocation, acceptRoutingLocation, route } = this.props;

    if (geocodeIsFetching || startLocation.isFetching || endLocation.isFetching) {
      // loading message for when location is being searched
      return <LoadingMsg message={'Searching...'} />;
    }

    if (geocodeError) {
      // geocode error message
      return <ErrorMsg error={geocodeError} />;
    }

    if (startLocation.distance && !startLocation.accepted) {
      return <StartLocationOptions {...{ geocodeResult, startLocation, acceptRoutingLocation }} />;
    }

    if (startLocation.accepted && !endLocation.coordinates.length) {
      // do nothing, previously this displayed StartLocationAcceptedOptions.jsx
      // see issue #50
    }

    if (endLocation.coordinates.length && !endLocation.accepted) {
      return <EndLocationOptions {...{ endLocation, geocodeResult, acceptRoutingLocation }} />;
    }

    if (!isMobile && endLocation.accepted && startLocation.accepted) {
      // also handles showing the route loading & error messages for desktop
      return <EndLocationAcceptedOptions {...{ route }} />;
    }

    if (isMobile && route.isLoadingRoute) {
      // handles showing the route loading msg for mobile
      return <LoadingMsg message={'Calculating route...'} />;
    }

    if (isMobile && route.error) {
      // handles showing the route error msg for mobile
      return <ErrorMsg error={route.error} />;
    }

    return null;
  }

  render() {
    return (
      <div className="SearchResults">
        { this.renderSearchResultsStep() }
      </div>
    );
  }
}

export default SearchResults;
