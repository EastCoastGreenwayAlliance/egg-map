import React from 'react';
import { Provider } from 'react-redux';
import { BrowserRouter as Router, Route, Switch } from 'react-router-dom';

import store from './store'; // default redux store
import HomeConnected from './containers/HomeConnected';
import CueSheet from './views/CueSheet';
import NotFound from './views/404';

const App = () => (
  <Provider store={store}>
    <Router>
      <Switch>
        <Route exact path="/" component={HomeConnected} />
        <Route path="/cuesheet" component={CueSheet} />
        <Route component={NotFound} />
      </Switch>
    </Router>
  </Provider>
);

export default App;