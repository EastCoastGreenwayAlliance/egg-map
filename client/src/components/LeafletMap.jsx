import React, { Component } from 'react';
import PropTypes from 'prop-types';
import isEqual from 'lodash/isEqual';
import Legend from '../../lib/L.Control.Legend';

import { configureLayerSource, queryZXY } from '../common/api';
import configureMapSQL from '../common/sqlQueries';
import { maxGeoBounds, mbURL } from '../common/config';

// set default image paths for Leaflet
// note that "ecg-map" will be set as the first directory if NODE_ENV === 'production'
// this is because Github Pages will be looking for the markers at:
// https://eastcoastgreenwayalliance.github.io/ecg-map/assets/icons/<filename>.png
// while locally it will be localhost:8080/assets/icons/<filename>.png
L.Icon.Default.imagePath = '/assets/icons';
L.Icon.Default.mergeOptions({
  iconRetinaUrl: '/assets/icons/marker-icon-2x.png',
  iconUrl: '/assets/icons/marker-icon.png',
  shadowUrl: '/assets/icons/marker-shadow.png',
});

/** Class that integrates Leaflet.JS with React and handles:
    - loading of basemap tiles & map interaction
    - toggling of basemap style from Positron and satellite
    - updating features to be shown on the map such as markers and the highlighted
      portion of the ECG route after a successful search
    - integrating Carto(db).JS for loading the ECG route as a tileLayer
    - enabling "Locate Me" and "Active Turning"
 */
class LeafletMap extends Component {
  static propTypes = {
    activeTurningEnabled: PropTypes.bool.isRequired,
    isMobile: PropTypes.bool.isRequired,
    reportLocationError: PropTypes.func.isRequired,
    lat: PropTypes.number.isRequired,
    lng: PropTypes.number.isRequired,
    zoom: PropTypes.number.isRequired,
    onMapMove: PropTypes.func.isRequired,
    geocodeResult: PropTypes.object,
    startLocation: PropTypes.object,
    endLocation: PropTypes.object,
    route: PropTypes.object,
    updateActiveTurning: PropTypes.func.isRequired,
    disableActiveTurning: PropTypes.func.isRequired,
  }

  constructor(props) {
    super(props);
    const { lat, lng, zoom } = props;
    const hashZXY = queryZXY();

    this.map = null;
    this.baseLayers = {
      'Detailed Streets': L.tileLayer(mbURL, {
        zIndex: 0,
      }),
      Greyscale: L.tileLayer('https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_all/{z}/{x}/{y}@2x.png', {
        maxZoom: 18,
        zIndex: 0,
      }),
      Satellite: L.tileLayer('http://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 18,
        zIndex: 0,
      }),
    };

    this.mapOptions = {
      attributionControl: false,
      center: [
        hashZXY.lat && hashZXY.lng ? hashZXY.lat : lat,
        hashZXY.lat && hashZXY.lng ? hashZXY.lng : lng,
      ],
      layers: [this.baseLayers.Greyscale],
      maxBounds: maxGeoBounds,
      scrollWheelZoom: false,
      minZoom: 4,
      maxZoom: 18,
      zoom: hashZXY.zoom || zoom,
      zoomControl: false,
    };

    const RouteIcon = L.Icon.extend({
      options: {
        shadowUrl: '/assets/icons/marker-shadow.png',
        iconSize: [38, 47],
        shadowSize: [41, 41],
        iconAnchor: [18, 46],
        shadowAnchor: [10, 40],
        popupAnchor: [2, -40]
      }
    });

    this.startIcon = new RouteIcon({
      iconUrl: '/assets/icons/icon-map-marker-green.png',
      iconRetinaUrl: '/assets/icons/icon-map-marker-green@2x.png'
    });

    this.endIcon = new RouteIcon({
      iconUrl: '/assets/icons/icon-map-marker-red.png',
      iconRetinaUrl: '/assets/icons/icon-map-marker-red.png'
    });

    // icon for the "active turning" feature
    this.gpsIcon = new L.Icon({
      iconUrl: '/assets/icons/youarehere.png',
      iconSize: [25, 25],
      iconAnchor: [12, 12],
      popupAnchor: [12, -12]
    });

    // reference to CARTO sublayer
    this.cartoSubLayer = null;

    // layer to store searchResults (route, markers, etc) when user is searching for a location
    this.searchResults = L.featureGroup();
    // and the subset of specifically the route segments
    this.searchRoute = undefined;

    // leaflet-locate control instance (mobile only)
    self.locateMe = null;
  }

  componentDidMount() {
    const { startLocation, endLocation, route } = this.props;

    // set up the Leaflet map
    this.initMap();

    // if we received preloaded state for start and end locations, show those on the map
    if (startLocation.accepted && startLocation.coordinates.length && endLocation.accepted
      && endLocation.coordinates.length) {
      this.zoomRouteExtent(startLocation, endLocation);
    }

    // if we received preloaded state for just a start location
    if (startLocation.accepted && startLocation.coordinates.length && !endLocation.accepted) {
      this.zoomToNearestSegment(startLocation);
    }

    // if the app state already has routing.response data to test,
    // add it to the map and set the map view to it
    if (route.response && startLocation.accepted && endLocation.accepted) {
      this.zoomRouteExtent(startLocation, endLocation);
      this.renderRouteHighlight(route.response);
    }
  }

  componentWillReceiveProps(nextProps) {
    const { activeTurningEnabled, geocodeResult, startLocation, endLocation, route } = nextProps;

    /* Handles adding the geocode result, if there is one */
    if (geocodeResult && !isEqual(geocodeResult, this.props.geocodeResult)) {
      this.displayGeocodeResult(geocodeResult);
    }

    /* Handles START point rendering and canceling */
    if (startLocation.coordinates.length &&
      !isEqual(startLocation.coordinates, this.props.startLocation.coordinates)) {
      // handle displaying the start location of the ECG route
      this.displayNearestSegment(startLocation);
    }

    if (!startLocation.coordinates.length && this.props.startLocation.coordinates.length) {
      // user canceled this part of the search, clear the map layers
      this.searchResults.clearLayers();
    }

    if (startLocation.accepted && !this.props.startLocation.accepted) {
      // zoom to the ECG starting segment
      this.zoomToNearestSegment(startLocation);
    }

    /* Handles END point rendering and canceling */
    if (endLocation.coordinates.length &&
      !isEqual(endLocation.coordinates, this.props.endLocation.coordinates)) {
      // handle displaying the end location of the ECG route
      this.displayNearestSegment(endLocation);
    }

    if (!endLocation.coordinates.length && this.props.endLocation.coordinates.length) {
      // user canceled this part of the search, clear the map layers
      this.searchResults.clearLayers();
    }

    if (startLocation.accepted && endLocation.accepted && !this.props.endLocation.accepted) {
      // zoom to the route extent
      this.zoomRouteExtent(startLocation, endLocation);
    }

    /* Handles displaying of selection portion of the route */
    if (route.response && !this.props.route.response) {
      this.renderRouteHighlight(route.response);
    }

    /* Handles enabling & disabling of "active turning" */
    if (activeTurningEnabled && !this.props.activeTurningEnabled) {
      this.enableActiveTurning();
    }
    if (!activeTurningEnabled && this.props.activeTurningEnabled) {
      this.disableActiveTurning();
    }
  }

  shouldComponentUpdate() {
    // Let Leaflet handle this part of the DOM, not React!
    // NOTE: life cycle methods componentWillUpdate and componentDidUpdate will never get called
    return false;
  }

  initMap() {
    // sets up the Leaflet map.
    // NOTE: attribution fixes are called within the initCartoLayer callback
    // map zoom buttons are conditionally added there as well, otherwise the attribution
    // is placed on top of them
    const { onMapMove, isMobile, disableActiveTurning } = this.props;
    const self = this;

    // instantiate the map and add a reference to it
    this.map = L.map('map', this.mapOptions);

    // "locate me" feature only available on mobile devices
    if (isMobile) {
      // import the code for the Leaflet-Locate plugin
      import('../../lib/L.Control.Locate')
        .then(() => {
          // add the plugin
          self.locateMe = L.control.locate({
            cacheLocation: true,
            position: 'topright',
            icon: 'btn-locate',
            iconLoading: 'loading',
            locateOptions: {
              enableHighAccuracy: true,
            },
            metric: false,
            markerStyle: {
              color: '#136AEC',
              fillColor: '#2A93EE',
              fillOpacity: 1,
              weight: 2,
              opacity: 0.9,
              radius: 5
            },
            stopCallback: disableActiveTurning,
          }).addTo(this.map);
        })
        .catch((error) => { throw error; });
    }

    // add the basemap toggle control
    this.layersControl = L.control.layers(this.baseLayers, null);
    this.layersControl.addTo(this.map, { position: 'topright' });

    // add the legend control
    this.legend = new Legend();
    this.legend.addTo(this.map);

    // add the scale bar control
    L.control.scale().addTo(this.map);

    // update the URL hash with zoom, lat, lng
    this.map.on('moveend', (e) => {
      if (e && e.target) {
        const zoom = e.target.getZoom();
        const latLng = e.target.getCenter();
        onMapMove(zoom, latLng.lat, latLng.lng);
      }
    });

    // add the search results feature group to the map for storing markers & paths
    this.searchResults.addTo(this.map);

    // set up the CARTO basemap layer
    this.initCartoLayer();

    // for debugging...
    // window.map = this.map;
    // window.searchResults = this.searchResults;
  }

  initCartoLayer() {
    const self = this;
    const layerSource = configureLayerSource(configureMapSQL());
    const options = {
      https: true,
      infowindow: true,
      legends: false,
    };
    // `cartodb` is a global var, refers to CARTO.JS: https://carto.com/docs/carto-engine/carto-js/
    cartodb.createLayer(self.map, layerSource, options)
      .addTo(self.map, 5) // 2nd param is layer z-index
      .on('done', (layer) => {
        self.cartoLayer = layer;
        layer.on('error', (error) => { throw error; });
        // store a reference to the Carto SubLayer so we can act upon it later,
        // mainly to update the SQL query based on filters applied by the user
        self.cartoSubLayer = layer.getSubLayer(0);

        // fix the map attribution
        self.fixMapAttribution();
      })
      .on('error', (error) => { throw error; });
  }

  fixMapAttribution() {
    const { isMobile } = this.props;
    // when a user changes the basemap layer, show the correct attribution for the provider
    // leaflet's layer control does a poor job of handling this on its own.
    const attr = document.querySelector('.leaflet-control-attribution.leaflet-control');
    attr.innerHTML = '© <a target="_blank" href="https://www.mapbox.com/about/maps/">Mapbox</a> © <a target="_blank" href="http://www.openstreetmap.org/copyright">OpenStreetMap<a/>';

    // if we're on desktop add zoom buttons
    // adding zoom buttons here because otherwise the attribution is placed on top
    // of them and looks wrong
    this.zoomControl = !isMobile ?
      L.control.zoom({ position: 'bottomright' }).addTo(this.map) : null;

    this.map.on('baselayerchange', (e) => {
      // set the correct attribution
      switch (e.name) {
        case 'Greyscale':
          attr.innerHTML = '© <a target="_blank">CARTO</a> © <a target="_blank" href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>';
          break;
        case 'Detailed Streets':
          attr.innerHTML = '© <a target="_blank" href="https://www.mapbox.com/about/maps/">Mapbox</a> © <a target="_blank" href="http://www.openstreetmap.org/copyright">OpenStreetMap<a/>';
          break;
        case 'Satellite':
          attr.innerHTML = '© <a target="_blank" href="http://www.esri.com/">Esri</a>';
          break;
        default:
          return null;
      }
    });
  }

  enableActiveTurning() {
    const { updateActiveTurning, reportLocationError } = this.props;

    // start geolocation tracking, simply moving the marker but not otherwise affecting the map
    this.locateMe.start();

    this.map.on('locationfound', (e) => {
      // if there's a route, find where we are on it and the next cue point
      // if we're too far off it, some wording changes (sort of an implicit disclaimer)
      // and we may want to disable some of it if they're far enough off (TBD)
      const activeTurningUpdate = {};

      if (this.searchRoute) {
        // find route segment with closest approach to e.latlng
        const closest = { segment: null, distance: Infinity };
        this.searchRoute.getLayers().forEach((routesegment) => {
          const segmentvertices = routesegment.getLatLngs()[0];
          for (let i = 0, l = segmentvertices.length; i < l - 1; i += 1) {
            const p = this.map.latLngToLayerPoint(e.latlng); // me
            const p1 = this.map.latLngToLayerPoint(segmentvertices[i]); // vertex
            const p2 = this.map.latLngToLayerPoint(segmentvertices[i + 1]); // vertex +1
            const px = L.LineUtil.closestPointOnSegment(p, p1, p2); // closest pixel to me
            const pd = this.map.layerPointToLatLng(px); // pixel back to latlng
            const d = e.latlng.distanceTo(pd); // meters distance between me + closest

            if (d < closest.distance) {
              closest.segment = routesegment;
              closest.distance = d;
            }
          }
        });

        // compose some easy-to-interpolate strings about the situation
        const METERS_TO_MILES = 1609;
        const METERS_TO_FEET = 3.281;
        const nearline = closest.segment;
        const nearmile = (closest.distance / METERS_TO_MILES).toFixed(2);
        const nearfeet = Math.round(closest.distance * METERS_TO_FEET);
        const nearname = nearline.properties.title;
        const untilturn = nearline.properties.length / METERS_TO_MILES;

        if (nearmile > 0.1) { // over this = off route, please return to route
          activeTurningUpdate.onpath = false;
          activeTurningUpdate.currentplace = `Return to ${nearname}, ${nearmile} miles`;
          activeTurningUpdate.transition_code = nearline.properties.transition.code;
          activeTurningUpdate.transition_text = nearline.properties.transition.title;
          activeTurningUpdate.distance = `${untilturn.toFixed(1)} mi`;
        } else if (nearmile > 0.03) { // over this = off route, please return to route
          activeTurningUpdate.onpath = false;
          activeTurningUpdate.currentplace = `Return to ${nearname}, ${nearfeet} feet`;
          activeTurningUpdate.transition_code = nearline.properties.transition.code;
          activeTurningUpdate.transition_text = nearline.properties.transition.title;
          activeTurningUpdate.distance = `${untilturn.toFixed(1)} mi`;
        } else {
          activeTurningUpdate.onpath = true;
          activeTurningUpdate.currentplace = `On ${nearname}`;
          activeTurningUpdate.transition_code = 'RT';
          activeTurningUpdate.transition_text = 'Turn Right';
          activeTurningUpdate.transition_code = nearline.properties.transition.code;
          activeTurningUpdate.transition_text = nearline.properties.transition.title;
          activeTurningUpdate.distance = `${untilturn.toFixed(1)} mi`;
        }
      }

      // hand it off to redux for digestion
      updateActiveTurning(activeTurningUpdate);
    });

    // dispatch error if a Leaflet locate geolocation error occurs
    this.map.on('locationerror', error => reportLocationError(error.message));
  }

  disableActiveTurning() {
    this.locateMe.stop();
  }

  fitBoundsToSearchResults(...padding) {
    const options = {};

    if (padding.length > 1) {
      options.paddingTopLeft = padding[0];
      options.paddingBottomRight = padding[1];
    }

    if (padding.length === 1) {
      options.padding = padding[0];
    }

    // fit the map bounds to the search results featureGroup
    this.map.fitBounds(this.searchResults.getBounds(), options);
  }

  displayGeocodeResult(geocodeResult) {
    const { coordinates, addressFormatted } = geocodeResult;
    const { startLocation, endLocation } = this.props;

    // if it's a new search and the user hasn't accepted start, clear the search layers
    if (!startLocation.accepted || !endLocation.accepted) {
      this.searchResults.clearLayers();
    }

    // add the search result to the map
    this.searchResults.addLayer(
      L.marker(coordinates, {
        icon: startLocation.accepted ? this.endIcon : this.startIcon
      }).bindPopup(addressFormatted)
    );
  }

  displayNearestSegment(location) {
    // adds the nearest ECG segment to the map as well as a line connecting it to
    // the last used location geocode result
    const { coordinates } = location;
    const { geocodeResult, isMobile } = this.props;

    if (coordinates.length) {
      const padding = isMobile ? [[0, 50], [50, 185]] : [[330, 0], [60, 0]];
      // display marker showing nearest ECG location
      this.searchResults.addLayer(
        L.circleMarker(location.coordinates, {
          color: '#1482c5',
          fillColor: '#1482c5',
          opacity: 0.8,
          fillOpacity: 0.6
        }).bindPopup(`Nearest ECG ${location.positionText} Location`)
      );
      // connect the nearest ECG location with the user's search
      this.searchResults.addLayer(
        L.polyline([
          geocodeResult.coordinates,
          location.coordinates
        ], {
          color: '#1482c5 ',
          dashArray: '12, 8',
          lineCap: 'butt',
        })
      );
      // fit the map extent to the user's search and neareset ECG location
      this.fitBoundsToSearchResults(...padding);
    }
  }

  zoomToNearestSegment(location) {
    this.searchResults.clearLayers();
    this.searchResults.addLayer(L.marker(location.coordinates, {
      icon: location.positionText === 'start' ? this.startIcon : this.endIcon
    }));
    this.map.panTo(location.coordinates);
  }

  zoomRouteExtent(startLocation, endLocation) {
    // user has finished selecting their start and end,
    // add start and end points, then zoom the map extent
    const { isMobile } = this.props;
    const padding = isMobile ? [[0, 50], [50, 160]] : [[330, 0], [60, 0]];

    this.searchResults.clearLayers();
    this.searchResults.addLayer(
      L.marker(startLocation.coordinates, {
        icon: this.startIcon
      }).bindPopup('Start')
    );
    this.searchResults.addLayer(
      L.marker(endLocation.coordinates, {
        icon: this.endIcon
      }).bindPopup('End')
    );
    this.fitBoundsToSearchResults(...padding);
  }

  renderRouteHighlight(routeGeoJson) {
    if (!routeGeoJson || !routeGeoJson.features || !routeGeoJson.features.length) {
      // don't try adding anything if no GeoJSON was returned from the router
      return;
    }

    const { isMobile } = this.props;
    const padding = isMobile ? [[0, 50], [50, 160]] : [[330, 0], [60, 0]];

    // keep a reference to just the route sections; this.searchResults will have other markers
    // and add .properties to the resulting L.linestring layers cuz Leaflet strips them
    this.searchRoute = L.geoJson(routeGeoJson, {
      onEachFeature: (feature, layer) => {
        layer.properties = feature.properties;
      }
    });
    this.searchResults.addLayer(this.searchRoute);
    this.fitBoundsToSearchResults(...padding);
  }

  render() {
    return (
      <div className="LeafletMap">
        <div id="map" />
      </div>
    );
  }
}

export default LeafletMap;
