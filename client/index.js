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

    // MAP.route = a featureGroup where we'll stick the lines for visualization
    MAP.route = L.featureGroup([]).addTo(MAP);

    // MAP.transitions = a featureGroup where we'll stick the transition point markersw
    MAP.transitions = L.featureGroup([]).addTo(MAP);
});
