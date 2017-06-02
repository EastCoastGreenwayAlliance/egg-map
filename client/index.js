var MAP;

var CARTO_VISUALIZATION_ID = "6ff63a84-423c-11e7-b1f7-0e3ebc282e83";

$(document).ready(function () {
    MAP = L.map('map', {
    }).fitBounds([ [24.5646034, -81.8152815], [45.1783131, -67.2807404] ]);

    L.tileLayer('https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_nolabels/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors, © CartoDB',
        zIndex: 0
    }).addTo(MAP);

    L.tileLayer('https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_only_labels/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors, © CartoDB',
        zIndex: 100
    }).addTo(MAP);

    L.control.scale().addTo(MAP);

    // a CARTO layer of the trail itself, for context
    cartodb.createLayer(MAP, 'https://' + CARTODB_USER + '.carto.com/api/v2/viz/' + CARTO_VISUALIZATION_ID + '/viz.json').addTo(MAP).on('done', function(layer) {
    });

    // MAP.route = a featureGroup where we'll stick the lines and markers for visualization
    MAP.route = L.featureGroup([]).addTo(MAP);

    // MAP.transitions = a featureGroup where we'll stick the transition point markers
    MAP.transitions = L.featureGroup([]).addTo(MAP);

    // MAP.pois = a featureGroup where we'll stick other points of interest and metadata
    MAP.pois = L.featureGroup([]).addTo(MAP);
});

function reset() {
    // empty the directions readout
    $('#directions').empty();

    // clear the transition-point markers
    MAP.transitions.clearLayers();

    // clear the point-of-interest markers
    MAP.pois.clearLayers();

    // clear the drawn line
    MAP.removeLayer(MAP.route);
}

function error(errormessage) {
    alert(errormessage);
}

function success(routejsondocument) {
    // metadata in the readout/listing
    var $readout = $('#directions');

    var miles     = (routejsondocument.properties.total_meters / 1609).toFixed(1);
    var startwalk = (routejsondocument.properties.startpoint_meters / 1609).toFixed(1);
    var endwalk   = (routejsondocument.properties.endpoint_meters / 1609).toFixed(1);
    $("<li></li>").html("Total trip length: " + miles + " miles").appendTo($readout);
    $("<li></li>").html("Starting point is " + startwalk + " miles off the trail").appendTo($readout);
    $("<li></li>").html("Ending point is " + endwalk + " miles off the trail").appendTo($readout);

    // the return is a GeoJSON-compatible structure ready for Leaflet consumption
    // aside from the metadata above, this document's main payload of features (the route) can consumed as-given by nearly any map library
    MAP.route = L.geoJson(routejsondocument, {
        onEachFeature: function (feature, layer) {
            // each step is a line feature
            // but also it contains info about where the feature ends and joins to the next one
            // for those, we want a marker on the map
            var miles = (feature.properties.length / 1609).toFixed(1);
            var popuphtml = 'Transition code ' + feature.properties.transition.code + '<br/>' + 'Leaving ' + feature.properties.id + ' ' + feature.properties.title + '<br/>' + 'after ' + miles + ' ' + 'miles' + '<br/>'

            var icon = new L.Icon({
                iconUrl: 'https://cdn.rawgit.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-black.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34],
            });

            L.marker([ feature.properties.transition.lat, feature.properties.transition.lng ], {
                icon: icon,
                title: feature.properties.transition.title
            })
            .bindPopup(popuphtml)
            .addTo(MAP.transitions);

            // for each step along this trip, we want to list it in the text readout
            var html = "";
            html += 'After ' + miles + ' ' + 'miles' + '<br/>';
            html += feature.properties.transition.title + '<br/>';
            html += 'Transition code: ' + feature.properties.transition.code + '<br/>';
            html += 'Leaving segment: ' + feature.properties.id + ' ' + feature.properties.title + '<br/>';

            var $readout = $('#directions');
            $("<li></li>").html(html).appendTo($readout);
        },
        style: function (feature) {
            return { color: 'orange', clickable: false  };
        },
    }).addTo(MAP);

    // metadata points: the actual starting and ending points on the trail, and the requested starting and ending points
    // these are also GeoJSON-compliant features separate from the typical "features" payload, so can use standard Leaflet processing
    L.geoJson(routejsondocument.properties.startpoint_wanted, {
        pointToLayer: function (feature, latlng) {
            var icon = new L.Icon({
                iconUrl: 'https://cdn.rawgit.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34],
            });

            var popuphtml = "Requested start" + '<br/>' + startwalk + ' miles from trail';
            return L.marker(latlng, {icon: icon, title: "Requested start"}).bindPopup(popuphtml).addTo(MAP.pois);
        },
    });
    L.geoJson(routejsondocument.properties.startpoint_trail, {
        pointToLayer: function (feature, latlng) {
            var icon = new L.Icon({
                iconUrl: 'https://cdn.rawgit.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-yellow.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34],
            });

            var popuphtml = "Trail start" + '<br/>' + startwalk + ' miles from requested';
            return L.marker(latlng, {icon: icon, title: "Trail closest to start"}).bindPopup(popuphtml).addTo(MAP.pois);
        },
    });
    L.geoJson(routejsondocument.properties.endpoint_wanted, {
        pointToLayer: function (feature, latlng) {
            var icon = new L.Icon({
                iconUrl: 'https://cdn.rawgit.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34],
            });

            var popuphtml = "Requested destination" + '<br/>' + endwalk + ' miles from trail';
            return L.marker(latlng, {icon: icon, title: "Requested destination"}).bindPopup(popuphtml).addTo(MAP.pois);
        },
    });
    L.geoJson(routejsondocument.properties.endpoint_trail, {
        pointToLayer: function (feature, latlng) {
            var icon = new L.Icon({
                iconUrl: 'https://cdn.rawgit.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-violet.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34],
            });

            var popuphtml = "Trail destination" + '<br/>' + endwalk + ' miles from requested';
            return L.marker(latlng, {icon: icon, title: "Trail closest to destination"}).bindPopup(popuphtml).addTo(MAP.pois);
        },
    });

    // zoom to the extent
    MAP.fitBounds(MAP.route.getBounds());
}

//
// and now some specific demo routes
//

function routeA() {
    // 7th and Townsend St -> 2nd St in Darien, GA
    // overlaps the "A" demo significantly BUT ALSO jumps a break in the cue points, proving that they are not used
    reset();
    ROUTER.findRoute(31.1811, -81.4993, 31.3640, -81.4193, success, error);
}

function routeB1() {
    // Fernandina Beach GA  to St Augustine Beach, FL
    reset();
    ROUTER.findRoute(30.6774573, -81.4524394, 29.8398334,-81.2731937, success, error);
}

function routeB2() {
    // Fernandina Beach GA  to St Augustine Beach, FL
    reset();
    ROUTER.findRoute(29.8398334,-81.2731937, 30.6774573, -81.4524394, success, error);
}

function routeC() {
    // Palm Coast FL to Palatka FL
    reset();
    ROUTER.findRoute(29.5845, -81.2079, 29.6486, -81.6376, success, error);
}

function routeD1() {
    // Daytona Beach FL to Pierson FL
    reset();
    ROUTER.findRoute(29.367379,-81.148852, 29.2336339,-81.4714865, success, error);
}

function routeD2() {
    // Pierson FL to Daytona Beach FL
    reset();
    ROUTER.findRoute(29.2336339,-81.4714865, 29.367379,-81.148852, success, error);
}

function routeE() {
    // Durham NC to Greenville NC
    reset();
    ROUTER.findRoute(36.0020228,-79.0253383, 35.6030521,-77.4475665, success, error);
}

function routeZ() {
    // Key West, FL to Calais, ME
    // the complete length of the whole trail
    reset();
    ROUTER.findRoute(24.5646034,-81.8152815, 45.1783131,-67.2807404, success, error);
}

function routeZ01() { // Key West, FL to Hollywood, FL
    reset(); ROUTER.findRoute(24.5646034,-81.8152815, 26.0112, -80.1495, success, error);
}
function routeZ02() { // Hollywood, FL to Fort Pierce, FL
    reset(); ROUTER.findRoute(26.0112, -80.1495, 27.4467, -80.3256, success, error);
}
function routeZ03() { // Fort Pierce, FL to Pierson, FL
    reset(); ROUTER.findRoute(27.4467, -80.3256, 29.2336339, -81.4714865, success, error);
}
function routeZ04() { // Pierson, FL to Kingsland, GA
    reset(); ROUTER.findRoute(29.2336339, -81.4714865, 30.8000, -81.6898, success, error);
}
function routeZ05() { // Kingsland, GA to Darien, GA
    reset(); ROUTER.findRoute(30.8000, -81.6898, 31.3702, -81.4340, success, error);
}
function routeZ06() { // Darien, GA to Savannah, GA
    reset(); ROUTER.findRoute(31.3702, -81.4340, 32.0835, -81.0998, success, error);
}
function routeZ07() { // Savannah, GA to Charleston, NC
    reset(); ROUTER.findRoute(32.0835, -81.0998, 32.776566, -79.930923, success, error);
}
function routeZ08() { // Charleston, NC to Baltimore, MD
    reset(); ROUTER.findRoute(32.776566, -79.930923, 39.2904, -76.6122, success, error);
}
function routeZ09() { // Baltimore, MD to Trenton, NJ
    reset(); ROUTER.findRoute(39.2904, -76.6122, 40.2171, -74.7429, success, error);
}
function routeZ10() { // Trenton, NJ to Bronx, NY
    reset(); ROUTER.findRoute(40.2171, -74.7429, 40.8448, -73.8648, success, error);
}
function routeZ11() { // New York City, NY to Bridgeport, CT
    reset(); ROUTER.findRoute(40.7128, -74.0059, 41.1865, -73.1952, success, error);
}
function routeZ12() { // Bridgeport, CT to Hartford, CT
    reset(); ROUTER.findRoute(41.1865, -73.1952, 41.7637, -72.6851, success, error);
}
function routeZ13() { // Hartford, CT to Providence, RI
    reset(); ROUTER.findRoute(41.7637, -72.6851, 41.8240, -71.4128, success, error);
}
function routeZ14() { // Providence, RI to Eastham, MA
    reset(); ROUTER.findRoute(41.8240, -71.4128, 41.8300, -69.9740, success, error);
}
function routeZ15() { // Eastham, MA to Seabrook, ME
    reset(); ROUTER.findRoute(41.8300, -69.9740, 42.8910, -70.8655, success, error);
}
function routeZ16() { // Seabrook, ME to Brunswick, ME
    reset(); ROUTER.findRoute(42.8910, -70.8655, 43.9140, -69.9670, success, error);
}
function routeZ17() { // Brunswick, ME to Bangor, ME
    reset(); ROUTER.findRoute(43.9140, -69.9670, 44.8012, -68.7778, success, error);
}
function routeZ18() { // Bangor, ME to Machias, ME
    reset(); ROUTER.findRoute(44.8012, -68.7778, 44.7151, -67.4614, success, error);
}
function routeZ19() { // Machias, ME to Calais, ME on a southbound street requiring some right turns
    reset(); ROUTER.findRoute(44.71354289, -67.46046, 45.1783,-67.2807, success, error);
}
