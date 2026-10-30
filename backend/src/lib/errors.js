"use strict";
/** An error whose status and message are safe to show the person. */
function fail(status, message, code) {
  const e = new Error(message);
  e.status = status; e.expose = true;
  if (code) e.code = code;
  return e;
}
module.exports = { fail };
