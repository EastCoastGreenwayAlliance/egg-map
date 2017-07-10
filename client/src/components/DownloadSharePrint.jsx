import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import isEqual from 'lodash/isEqual';

import { loadToGPX, loadFileSaver } from '../common/api';

/** Class that displays UI and handles:
    - creation and download of GPX file from route.response
    - sharing of route via stateful URL (TODO)
    - linking to cuesheet view
*/
class DownloadSharePrint extends Component {
  static propTypes = {
    startLocation: PropTypes.object,
    endLocation: PropTypes.object,
    route: PropTypes.object,
    isMobile: PropTypes.bool.isRequired,
  }

  constructor() {
    super();
    this.state = {
      gpx: null,
      error: null,
    };
    this.togpx = null;
    this.fileSaver = null;
  }

  componentDidUpdate(prevProps, prevState) {
    const { gpx } = prevState;

    // we have GPX data, create the blob and tell the browser to download it
    if (this.state.gpx && !isEqual(this.state.gpx, gpx)) {
      this.downloadGPXFile(this.state.gpx);
    }
  }

  convertToGPX(routeData) {
    const self = this;
    const geojson = { ...routeData };
    let gpx;
    let gpxConversionError;

    // we don't need the downsampled route data, so remove it
    delete geojson.downsampled;

    // sets the "name" field in the GPX file
    function featureTitle(feature) {
      return feature.title;
    }

    // sets the "desc" field in the GPX file
    function featureDescription(feature) {
      return feature.transition.title;
    }

    // converts the GeoJSON response to a GPX string
    // sets component state with the gpx response and/or error
    function gpxConversion() {
      try {
        gpx = self.togpx(geojson, {
          featureTitle,
          featureDescription,
        });
      } catch (e) {
        gpxConversionError = e;
        throw e;
      }

      self.setState({
        gpx,
        error: gpxConversionError,
      });
    }

    // dynamically imports "togpx.js" library if it hasn't been imported already
    if (!this.togpx) {
      loadToGPX((error, response) => {
        if (error) throw error;
        this.togpx = response;
        gpxConversion();
      });
    } else {
      gpxConversion();
    }
  }

  downloadGPXFile(gpxString) {
    // creates a Blob for the GPX string and downloads it to the user's computer
    const self = this;

    function saveFile() {
      const blob = new Blob([gpxString], { type: 'text/plain;charset=utf-8' });
      self.fileSaver.saveAs(blob, 'my-ecg-route.gpx');
    }

    // dynamically imports "file-saver.js" library if it hasn't been imported already
    if (!this.fileSaver) {
      loadFileSaver((error, response) => {
        if (error) throw error;
        self.fileSaver = response;
        saveFile();
      });
    } else {
      saveFile();
    }
  }

  render() {
    const { route, isMobile } = this.props;

    if (!route.response || !route.response.features) return null;

    // don't show this component on mobile, it isn't useful & takes up space
    if (isMobile) return null;

    return (
      <div className="DownloadSharePrint">
        <button className="dps-download" onClick={() => this.convertToGPX(route.response)}><span /></button>
        <button className="dps-share" onClick={() => {}}><span /></button>
        <Link to={'/cuesheet'}>
          <button className="dps-print" onClick={() => {}}><span /></button>
        </Link>
      </div>
    );
  }
}

export default DownloadSharePrint;
