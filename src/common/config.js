import packageJSON from '../../package.json';

// App wide configuration goes here
// e.g. our app's base URL; if deployed on Github Pages as a Project Page
// then we need to add the sub-directory name
export const baseURL = process.env.NODE_ENV === 'production' ? `/${packageJSON.name}` : '';

export const googleAPIKey = 'AIzaSyAFBQ5xLgNikyYrlnfvbfODyO35g3k-IkU';

// Mailchimp tokens
export const mailchimpAPIKey = '6b8b1d41b3a079e4950fb015a11d4d6d-us8';
export const mailchimpServerInstance = mailchimpAPIKey.split('-')[1];
export const mailchimpListID = '76888a861e';

// CARTO account name (temporarily set to "greeninfo" until data is in order)
export const cartoUser = 'greeninfo';

// CARTO tables (temporary tables for testing data in app)
export const cartoTables = {
  route_segments: 'ecglines_clean_unique',
  cue_points: 'ecgpoints_clean_unique',
};

// route segment field names to appear within InfoWindows / PopUps
export const routeSegmentsFieldsVisible = [
  'line_type',
  'direction',
  'meters',
  'title',
];

// route segment fields for SQL queries
export const routeSegmentFieldsSQL = [
  ...routeSegmentsFieldsVisible,
  'cartodb_id',
  'the_geom',
  'south_weight',
  'north_weight',
  'pline_id',
];

export const maxGeoBounds = [[18.312811, -110.830078], [53.278353, -45.351563]];
