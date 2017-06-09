import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { setStorageItem, getStorageItem } from '../utils/localStorage';

class ModalContent extends Component {
  static propTypes = {
    handleCloseModal: PropTypes.func.isRequired,
    handleFormSubmit: PropTypes.func.isRequired,
  }

  constructor(props) {
    super(props);
    const showModal = getStorageItem('ecg-modal-form');
    this.state = {
      noDisplayInFuture: showModal || false,
      email: '',
      valid: false,
      submitted: false,
    };
    this.handleTextChange = this.handleTextChange.bind(this);
    this.handleCheckboxChange = this.handleCheckboxChange.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
  }

  componentDidMount() {
    const { noDisplayInFuture } = this.state;
    // close the modal prematurely if user checked "don't show in the future"
    if (noDisplayInFuture) this.props.handleCloseModal();
  }

  componentWillUpdate(nextProps, nextState) {
    // set localstorage to not show intro modal if they checked "don't show in the future"
    if (this.state.noDisplayInFuture !== nextState.noDisplayInFuture) {
      setStorageItem('ecg-modal-form', nextState.noDisplayInFuture);
    }
  }

  handleTextChange(event) {
    event.preventDefault();
    const value = event.target.value;

    // validate the user's email before we enable the form to be submitted
    if (/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(value)) {
      this.setState({
        email: event.target.value,
        valid: true
      });
    } else {
      this.setState({
        email: event.target.value,
        valid: false
      });
    }
  }

  handleCheckboxChange() {
    this.setState({
      noDisplayInFuture: !this.state.noDisplayInFuture
    });
  }

  handleSubmit(e) {
    const { email } = this.state;
    e.preventDefault();
    this.setState({ submitted: true });
    this.props.handleFormSubmit(email);
    this.props.handleCloseModal();
  }

  render() {
    const { handleCloseModal } = this.props;
    const { noDisplayInFuture, email, valid } = this.state;

    const buttonStyle = {
      background: valid ? '#65bf80' : 'hsl(0,0%,50%)',
      color: valid ? '#fff' : '#eee'
    };

    return (
      <div className="ModalContent">
        <button className="modal-content__close" onClick={() => handleCloseModal()}>×</button>
        <div className="modal-content__top-box">
          <h5 className="modal-content__greeting-copy">
            The East Coast Greenway is a 2,500 mile traffic free path linking east
            coast cities from Maine to Florida. Use this map to get to the Greenway
            and plan trips along it.
          </h5>
        </div>
        <div className="modal-content__bottom-box">
          <form
            className="modal-content__signup-form"
            onSubmit={this.handleSubmit}
          >
            <fieldset className="email-signup-group">
              <label
                htmlFor="MERGE0"
                className="signup-copy"
              >
                { 'Sign up to receive Greenway map, event, & program updates.' }
              </label>
              <div className="signup-input-button-group">
                <input
                  className="signup-input"
                  type="email"
                  name="MERGE0"
                  id="MERGE0"
                  autoCapitalize="off"
                  autoCorrect="off"
                  tabIndex={0}
                  placeholder="email address"
                  value={email}
                  onChange={this.handleTextChange}
                />
                <input
                  className="signup-submit"
                  type="submit"
                  tabIndex={0}
                  onClick={() => {}}
                  disabled={!valid}
                  style={buttonStyle}
                  value="Sign Up"
                />
              </div>
            </fieldset>
            <fieldset className="hide-modal-group">
              <input
                className="hide-modal-checkbox"
                id="hide-modal"
                type="checkbox"
                checked={noDisplayInFuture}
                onChange={this.handleCheckboxChange}
              />
              <label
                className="hide-modal-label"
                htmlFor="hide-modal"
              >
                { 'Do not display this message in the future' }
              </label>
            </fieldset>
          </form>
        </div>
      </div>
    );
  }
}

export default ModalContent;
