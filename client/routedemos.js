function success(route) {
    // list the directions in the readout
    var $readout = $('#directions').empty();
    route.forEach(function (routestep) {
        $("<li></li>").text(routestep.debug).appendTo($readout);
    });

    // add the segments to the map, rewriting them to contain the properties, popups, etc.
    var wktwriter = new jsts.io.GeoJSONWriter();
    route.forEach(function (routestep) {
        var j = wktwriter.write(routestep.geom);
        j.properties = {
            id: routestep.id,
            title: routestep.title,
        };

        L.geoJson(j, {
            style: function (feature) {
                return { clickable: false  }; // add other colors etc here
            },
        }).addTo(MAP.route);
    });
    MAP.fitBounds(MAP.route.getBounds());
}

function error(errormessage) {
    alert(errormessage);
}

function reset() {
    $('#directions').empty();
    MAP.route.clearLayers();
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
