import 'babel-polyfill';
import React from 'react';
import { render } from 'react-dom';
import { Provider } from 'react-redux';
import { BrowserRouter as Router, Route, Switch } from 'react-router-dom';

import { baseURL } from './common/config';

import '../scss/main.scss'; // tell webpack to use our scss
import store from './store'; // default redux store
import AppConnected from './containers/AppConnected';
import CueSheet from './views/CueSheet';
import NotFound from './views/404';

const basename = baseURL || null;

render(
  <Provider store={store}>
    <Router basename={`${basename}`}>
      <Switch>
        <Route exact path="/" component={AppConnected} />
        <Route path="/cuesheet" component={CueSheet} />
        <Route component={NotFound} />
      </Switch>
    </Router>
  </Provider>,
  document.getElementById('root')
);
