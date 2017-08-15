// disable eslint es6 specific rules because we're using Node@6.x
/* eslint-disable no-var */
/* eslint-disable prefer-arrow-callback */
/* eslint-disable func-names */
/* eslint-disable prefer-template */
/* eslint-disable no-console */

var http = require('http');
var express = require('express');
var bodyParser = require('body-parser');
var request = require('superagent');
var morgan = require('morgan');
var path = require('path');
var enforce = require('express-sslify');

var ecgrouting = require('./ecg-path-routing');

// mailchimp API settings are stored in the .env file
var mailchimpAPIKey = process.env.MAILCHIMP_API_KEY;
var mailchimpServerInstance = mailchimpAPIKey.split('-')[1];
var mailchimpListID = process.env.MAILCHIMP_LIST_ID;
// mailchimp API url
var url = `https://${mailchimpServerInstance}.api.mailchimp.com/3.0/lists/${mailchimpListID}/members/`;

var app = express();

// enforces HTTPS connections on any incoming GET and HEAD requests
if (process.env.NODE_ENV === 'production') {
  app.use(enforce.HTTPS({ trustProtoHeader: true }));
}

// setup logging
app.use(morgan(':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] :response-time ms'));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

function makePostRequest(strEmail, res) {
  request.post(url)
    .set('Content-Type', 'application/json;charset=utf-8')
    .set('Authorization', 'Basic ' + new Buffer('any:' + mailchimpAPIKey).toString('base64'))
    .send({
      email_address: strEmail,
      status: 'subscribed',
    })
    .end(function(error, response) {
      if (response.status < 300 || (response.status === 400 && response.body.title === 'Member Exists')) {
        res.send('Signed Up!');
      } else {
        res.status(500).send('Sign Up Failed :(', error);
      }
    });
}

// Serve static assets
app.use(express.static(path.resolve(__dirname, 'client/dist')));


// routing: given a latlng, find the neraest section of the path to that latlng and return details about it
// params:
//    lat   Latitude of the desired location.
//    lng   Longitude of the desired location.
// returns:
//    JSON-encoded object of the closest trail segment.
//    Attributes:
//      id      The ID# of that segment of the trail, e.g. 12345
//      title   The display name of that segment of the trail, e.g. "Smith Loop Road"
//      wanted_lat    The requested latlng location; latitude ordinate.
//      wanted_lng    The requested latlng location; longitude ordinate.
//      closest_lat   The closest point on the trail to the desired latlng; latitude ordinate.
//      closest_lng   The closest point on the trail to the desired latlng; longitude ordinate.
//      closest_distance    Distance in meters between the wanted latlng and the closest latlng.
//      e   The bounding box of that segment; east ordinate.
//      w   The bounding box of that segment; west ordinate.
//      s   The bounding box of that segment; south ordinate.
//      n   The bounding box of that segment; north ordinate.
// examples:
//    http://localhost:5001/route/nearestpoint/?lat=42.3601&lng=-71.0589
//    http://localhost:5001/route/nearestpoint/?lat=41.8240&lng=-71.4128
app.get('/route/nearestpoint/', (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const options = {
    trailonly: true
  };

  const success = function (segment) {
    res
    .set('Content-Type', 'application/json')
    .json(segment);
  };

  const failure = function (errmsg) {
    res
    .set('Content-Type', 'text/plain')
    .send(errmsg);
  };

  ecgrouting.findNearest(lat, lng, success, failure, options);
});

// routing: given 2 latlngs, find the nearest point-on-route same as nearestpoint, then find a route between them
// params:
//    slat   Latitude of the desired starting location.
//    slng   Longitude of the desired starting location.
//    tlat   Latitude of the desired ending/target location.
//    tlng   Longitude of the desired ending/target location.
// returns:
//    JSON-encoded object of the closest trail segment.
//    Attributes:
//      GDA TODO
// examples:
//    http://localhost:5001/route/directions/?slat=42.3601&slng=-71.0589&tlat=41.8240&tlng=-71.4128
//    http://localhost:5001/route/directions/?slat=24.5646034&slng=-81.8152815&tlat=45.1783131&tlng=-67.2807404
//    http://localhost:5001/route/directions/?slat=24.5646034&slng=-81.8152815&tlat=31.3702&tlng=-81.4340
//    http://localhost:5001/route/directions/?slat=32.0835&slng=-81.0998&tlat=45.1783&tlng=-67.2807
app.get('/route/directions/', (req, res) => {
  const start_lat = parseFloat(req.query.slat);
  const start_lng = parseFloat(req.query.slng);
  const target_lat = parseFloat(req.query.tlat);
  const target_lng = parseFloat(req.query.tlng);

  const options = {
    // debug: true
  };

  const success = function (route) {
    res
    .set('Content-Type', 'application/json')
    .json(route);
  };

  const failure = function (errmsg) {
    res
    .set('Content-Type', 'text/plain')
    .send(errmsg);
  };

  ecgrouting.findRoute(start_lat, start_lng, target_lat, target_lng, options, success, failure);
});

// Handle Mailchimp API calls from the client
app.post('/signup', function(req, res) {
  // validate body content
  if (!req.body || !req.body.email_address) {
    return res.status(500).send('Invalid mailchimp post');
  }

  // validate email address
  if (/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(req.body.email_address)) {
    makePostRequest(req.body.email_address, res);
  } else {
    return res.status(500).send('Invalid email format');
  }
});

// Always return the main index.html, so react-router render the route in the client
app.get('*', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'client/dist', 'index.html'));
});

// necessary to use http.createServer for enforcing HTTPS
http.createServer(app).listen(process.env.PORT || 5001, function() {
  console.log('Listening on http://%s:%d/', this.address().address, this.address().port);
});
