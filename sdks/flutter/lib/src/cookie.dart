/// AuthOwl session cookie-name derivation.
library;

/// The exact session-cookie name the AuthOwl server sets for a project.
///
/// ```text
/// dev  (http):  p_<idNoDashes>.session_token
/// prod (https): __Secure-p_<idNoDashes>.session_token
/// ```
///
/// Note the DOT joining the prefix and the name, and the `__Secure-` (not
/// `__Host-`) prefix - both are easy to get wrong by hand, and getting either
/// wrong means reading a cookie the server never set.
///
/// [secure] must reflect the SERVER's cookie mode: derive it from the API URL's
/// scheme (`https` => true), not from the local request.
String sessionCookieName(String projectId, {bool secure = false}) {
  // LOWERCASED BECAUSE THE SERVER'S NAME ALWAYS IS: `projects.id` is a Postgres
  // `uuid`, which renders lowercase, and the engine builds the cookie prefix
  // from it. Cookie names are case-SENSITIVE, so a mixed-case id names a cookie
  // nothing ever set - sign-in works, the cookie jar then finds no match, and
  // the user reads as signed out with nothing in any log.
  final name = 'p_${projectId.toLowerCase().replaceAll('-', '')}.session_token';
  return secure ? '__Secure-$name' : name;
}
