/**
 * Chaster embeds extension pages in an iframe managed by iframe-resizer v4 (`scrolling="no"`): the parent only grows the
 * iframe to the page height if the page loads the iframe-resizer child script. Without it the dialog shows a fixed-height,
 * non-scrolling iframe. Docs: https://docs.chaster.app/api/extensions-api/create-your-extension/configuration-page
 * ("Adapt the iframe height", iframe-resizer 4.3.9). The script is inert when the page is not embedded.
 */
import 'iframe-resizer/js/iframeResizer.contentWindow.js';
