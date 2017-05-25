function success(route) {
    var $readout = $('#directions').empty();
    route.forEach(function (routestep) {
        $("<li></li>").text(routestep.debug).appendTo($readout);
    });
}

function error(errormessage) {
    alert(errormessage);
}

function routeA() {
    // 7th and Townsend St -> Drigger Blvd, near Darien, GA
    $('#directions').empty();
    ROUTER.findRoute(31.1811, -81.4993, 31.2795, -81.4393, success, error);
}

function routeB() {
    // 7th and Townsend St -> 2nd St in Darien, GA
    // overlaps the "A" demo significantly BUT ALSO jumps a break in the cue points, proving that they are not used
    $('#directions').empty();
    ROUTER.findRoute(31.1811, -81.4993, 31.3640, -81.4193, success, error);
}

function routeC() {
    // Fernandina Beach GA  to St Augustine Beach, FL
    $('#directions').empty();
    ROUTER.findRoute(30.6774573, -81.4524394, 29.8398334,-81.2731937, success, error);
}

function routeD() {
    // Pierson FL to Daytona Beach FL
    $('#directions').empty();
    ROUTER.findRoute(29.2088153,-81.1668217, 29.2336339,-81.4714865, success, error);
}

function routeE() {
    // Durham NC to Greenville NC
    $('#directions').empty();
    ROUTER.findRoute(36.0020228,-79.0253383, 35.6030521,-77.4475665, success, error);
}
