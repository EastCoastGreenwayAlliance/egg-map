import fetch from 'isomorphic-fetch';
import {
  MAILCHIMP_POST_REQUEST,
  MAILCHIMP_POST_SUCESS,
  MAILCHIMP_POST_ERROR,
} from '../common/actionTypes';
import {
  mailchimpAPIKey,
  mailchimpServerInstance,
  mailchimpListID,
} from '../common/config';

const mailchimpPostRequest = () => ({
  type: MAILCHIMP_POST_REQUEST,
});

const mailchimpPostSuccess = json => ({
  type: MAILCHIMP_POST_SUCESS,
  json,
});

const mailchimpPostError = error => ({
  type: MAILCHIMP_POST_ERROR,
  error,
});

const postMailchimpAPI = (data) => {
  const url = `https://${mailchimpServerInstance}.api.mailchimp.com/3.0/lists/${mailchimpListID}/members/`;
  // console.log(`Basic any:${mailchimpAPIKey}`);

  return (dispatch) => {
    dispatch(mailchimpPostRequest());
    return fetch(url, {
      method: 'POST',
      body: JSON.stringify({
        email_address: data,
        status: 'subscribed',
        user: `${new Buffer(`any:${mailchimpAPIKey}`).toString('base64')}`
      }),
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        Accept: 'application/json, application/xml, text/play, text/html, *.*',
        Authorization: `Basic ${new Buffer(`any:${mailchimpAPIKey}`).toString('base64')}`
      },
      credentials: 'include'
    })
      .then(res => res.text())
      .then(text => dispatch(mailchimpPostSuccess(text)))
      .catch(error => dispatch(mailchimpPostError(error)));
  };
};

export default postMailchimpAPI;
