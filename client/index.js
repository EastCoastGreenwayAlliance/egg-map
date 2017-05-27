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
});

function success(routejsondocument) {
    // the return is a GeoJSON-compatible structure ready for Leaflet consumption
    MAP.route = L.geoJson(routejsondocument, {
        onEachFeature: function (feature, layer) {
            // for each step along this trip, we want a marker on the map
            var miles = (feature.properties.length / 1609).toFixed(1);
            var popuphtml = 'Transition code ' + feature.properties.transition.code + '<br/>' + 'Leaving ' + feature.properties.id + ' ' + feature.properties.title + '<br/>' + 'after ' + miles + ' ' + 'miles' + '<br/>'

            L.marker([ feature.properties.transition.lat, feature.properties.transition.lng ], {
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

    // zoom to the extent
    MAP.fitBounds(MAP.route.getBounds());
}

function error(errormessage) {
    alert(errormessage);
}

function reset() {
    // empty the directions readout
    $('#directions').empty();

    // clear the transition-point markers
    MAP.transitions.clearLayers();

    // clear the drawn line
    MAP.removeLayer(MAP.route);
}

function routeA() {
    // 7th and Townsend St -> Drigger Blvd, near Darien, GA
    reset();
    ROUTER.findRoute(31.1811, -81.4993, 31.2795, -81.4393, success, error);
}

function routeB() {
    // 7th and Townsend St -> 2nd St in Darien, GA
    // overlaps the "A" demo significantly BUT ALSO jumps a break in the cue points, proving that they are not used
    reset();
    ROUTER.findRoute(31.1811, -81.4993, 31.3640, -81.4193, success, error);
}

function routeC() {
    // Fernandina Beach GA  to St Augustine Beach, FL
    reset();
    ROUTER.findRoute(30.6774573, -81.4524394, 29.8398334,-81.2731937, success, error);
}

function routeC2() {
    // Fernandina Beach GA  to St Augustine Beach, FL
    reset();
    ROUTER.findRoute(29.8398334,-81.2731937, 30.6774573, -81.4524394, success, error);
}

function routeD() {
    // Daytona Beach FL to Pierson FL
    reset();
    ROUTER.findRoute(29.2088153,-81.1668217, 29.2336339,-81.4714865, success, error);
}

function routeE() {
    // Durham NC to Greenville NC
    reset();
    ROUTER.findRoute(36.0020228,-79.0253383, 35.6030521,-77.4475665, success, error);
}

function routeF() {
    // West Palm Beach, FL to Wilington, NC
    reset();
    ROUTER.findRoute(26.7350102,-80.0997134, 34.2072579,-77.9417877, success, error);
}

function routeZ() {
    // Key West, FL to Calais, ME
    // the complete length of the whole trail
    reset();
    ROUTER.findRoute(24.5646034,-81.8152815, 45.1783131,-67.2807404, success, error);
}
