// This target owns its build and Android-only presentation while reusing the desktop player
// implementation. Shared player fixes are therefore picked up by both release targets.
import '../../desktop/src/main';
import './styles.css';
