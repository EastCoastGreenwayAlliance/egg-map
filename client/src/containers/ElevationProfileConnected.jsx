import { connect } from 'react-redux';

import ElevationProfile from '../components/ElevationProfile';

const mapStateToProps = ({ elevation, routing }) => {
  const { result, error, isFetching } = elevation;
  const { route } = routing;

  return {
    elevData: result,
    route,
    error,
    isFetching,
  };
};

export default connect(mapStateToProps, null)(ElevationProfile);
