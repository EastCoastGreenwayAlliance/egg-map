import 'babel-polyfill';
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import ReactModal from 'react-modal';

// import components
import NavBar from '../components/NavBar';
import SearchBox from '../components/SearchBox';
import LeafletMap from '../components/LeafletMap';
import ModalContent from '../components/ModalContent';

class App extends Component {
  static propTypes = {
    history: PropTypes.object, // via react-router
    location: PropTypes.object, // via react-router
    match: PropTypes.object, // via react-router
    staticContext: PropTypes.object, // via react-router
    isMobile: PropTypes.bool,
    postMailchimpAPI: PropTypes.func.isRequired,
  }

  constructor() {
    super();
    this.state = {
      showModal: true,
    };
    this.updateHash = this.updateHash.bind(this);
    this.handleCloseModal = this.handleCloseModal.bind(this);
  }

  updateHash(lat, lng, zoom) {
    const { history } = this.props;
    history.push({
      hash: `#${zoom}/${lat}/${lng}`
    });
  }

  handleCloseModal() {
    this.setState({ showModal: false });
  }

  render() {
    const { showModal } = this.state;
    const { isMobile, postMailchimpAPI } = this.props;

    return (
      <div className="App">
        <NavBar {...{ isMobile }} />
        <SearchBox />
        <LeafletMap
          lat={36.897}
          lng={-74.619}
          zoom={5}
          onMapMove={this.updateHash}
        />
        <ReactModal
          isOpen={showModal}
          onRequestClose={this.handleCloseModal}
          contentLabel="Welcome to the East Coast Greenway!"
          className="Modal"
          overlayClassName="ModalOverlay"
        >
          <ModalContent
            handleCloseModal={this.handleCloseModal}
            handleFormSubmit={postMailchimpAPI}
          />
        </ReactModal>
      </div>
    );
  }
}

export default App;
