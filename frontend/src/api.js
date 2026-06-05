import axios from 'axios';

// Determine the backend URL at runtime so the app works on any host
// (localhost, LAN IP, Tailscale IP, or MagicDNS hostname) without rebuilding.
// An explicit REACT_APP_API_URL env var still overrides everything.
const apiUrl =
  process.env.REACT_APP_API_URL ||
  `${window.location.protocol}//${window.location.hostname}:5000`;

axios.defaults.baseURL = apiUrl;

export default axios;