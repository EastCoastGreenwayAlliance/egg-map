import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { logLocationSearch } from '../../common/googleAnalytics';

/** Class for displaying the Location Search text input and firing geocoding API
    requests upon a search */
class SearchInput extends Component {
  static propTypes = {
    fetchLocationGeocode: PropTypes.func.isRequired,
    cancelRoutingLocation: PropTypes.func.isRequired,
    startLocation: PropTypes.object,
    endLocation: PropTypes.object,
    isLoadingRoute: PropTypes.bool.isRequired,
  }

  constructor() {
    super();
    this.state = {
      searchAddress: '',
    };
    this.textInput = null; // ref to the text input
    this.handleChange = this.handleChange.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
  }

  componentWillReceiveProps(nextProps) {
    const { startLocation, endLocation } = nextProps;

    // if user accepted a starting or ending location, clear our searchAddres state
    if (
        (startLocation.accepted && !this.props.startLocation.accepted) ||
        (endLocation.accepted && !this.props.endLocation.accepted)
      ) {
      // change the placeholder text
      this.setState({ searchAddress: '' });
    }
  }

  handleChange(e) {
    this.setState({
      searchAddress: e.target.value
    });
  }

  handleSubmit(e) {
    const { searchAddress } = this.state;
    const { startLocation, endLocation, fetchLocationGeocode,
      cancelRoutingLocation, isLoadingRoute } = this.props;

    e.preventDefault();

    // unfocus the text input, closes keyboard on iOS devices
    this.textInput.blur();

    // if we're loading route directions, don't allow the form to resubmit
    if (isLoadingRoute) return;

    // user has already confirmed a start and end location before this search, start over
    if (startLocation.accepted && endLocation.accepted) {
      cancelRoutingLocation('DONE');
    }

    // if there is text attempt to geocode it
    if (searchAddress && searchAddress.length) {
      fetchLocationGeocode(searchAddress);
    }

    // log the search event in Google Analytics
    logLocationSearch(startLocation.accepted, searchAddress);
  }

  handleSearchCancel() {
    const { startLocation, endLocation, cancelRoutingLocation, isLoadingRoute } = this.props;
    // handles how the search is canceled based on the current app state
    if (startLocation.coordinates.length && !endLocation.coordinates.length) {
      // clear the starting point data
      cancelRoutingLocation('START');
    }

    if (endLocation.coordinates.length && !endLocation.accepted) {
      // clear the ending point data
      cancelRoutingLocation('END');
    }

    if (startLocation.accepted && endLocation.accepted && !isLoadingRoute) {
      // start over
      cancelRoutingLocation('DONE');
    }

    // make sure to clear the search input
    this.setState({ searchAddress: '' });
  }

  renderPlaceholderText() {
    const { startLocation, endLocation } = this.props;
    let text = '';

    if (!startLocation.accepted && !endLocation.accepted) text = 'Search a Starting Point';
    if (startLocation.accepted && !endLocation.accepted) text = 'Search an Ending Point';
    if (startLocation.accepted && endLocation.accepted) text = 'Search Again';

    return text;
  }

  renderSuffixUI() {
    // handles whether or not to show the cancel "x" or magnify glass after the input
    const { startLocation, endLocation } = this.props;

    if (startLocation.coordinates.length || startLocation.accepted ||
        endLocation.coordinates.length || endLocation.accepted) {
      return (
        <button
          className="search-input-cancel"
          onClick={() => this.handleSearchCancel()}
        />
      );
    }

    return <span className="search-input-magnify-glass" />;
  }

  render() {
    const { searchAddress } = this.state;
    const { startLocation, endLocation } = this.props;

    const searchIconClassName = () => {
      const className = 'search-input-icon';
      const state = !endLocation.accepted && !startLocation.accepted ?
        'search-icon-start' : 'search-icon-end';
      return `${className} ${state}`;
    };

    return (
      <div className="SearchInput">
        <form onSubmit={this.handleSubmit}>
          <span className={searchIconClassName()} />
          <input
            ref={(_) => { this.textInput = _; }}
            type="search"
            placeholder={this.renderPlaceholderText()}
            value={searchAddress}
            onChange={this.handleChange}
          />
        </form>
        {
          this.renderSuffixUI()
        }
      </div>
    );
  }
}

export default SearchInput;
