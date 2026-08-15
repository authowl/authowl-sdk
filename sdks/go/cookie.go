package authowl

import "strings"

// SessionCookieName returns the exact session-cookie name the AuthOwl server
// sets for a project.
//
//	dev  (http):  p_<idNoDashes>.session_token
//	prod (https): __Secure-p_<idNoDashes>.session_token
//
// Note the DOT joining the prefix and the name, and the `__Secure-` (not
// `__Host-`) prefix - both are easy to get wrong by hand, and getting them wrong
// means reading a cookie the server never set. `secure` must reflect the
// SERVER's cookie mode: derive it from the API URL's scheme (https => true).
func SessionCookieName(projectID string, secure bool) string {
	// Lowercased because the server's name always is: `projects.id` is a Postgres
	// `uuid`, which renders lowercase, and the engine builds the cookie prefix
	// from it. Cookie names are case-SENSITIVE, so a mixed-case id names a cookie
	// nothing ever set, and the request reads as signed out for no visible reason.
	name := "p_" + strings.ToLower(strings.ReplaceAll(projectID, "-", "")) + ".session_token"
	if secure {
		return "__Secure-" + name
	}
	return name
}
