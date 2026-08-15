//! Session cookie-name derivation.

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
/// `secure` must reflect the SERVER's cookie mode: derive it from the API URL's
/// scheme (`https` => `true`), not from the local request.
///
/// ```
/// # use authowl::session_cookie_name;
/// assert_eq!(
///     session_cookie_name("a-b-c", true),
///     "__Secure-p_abc.session_token",
/// );
/// ```
pub fn session_cookie_name(project_id: &str, secure: bool) -> String {
    // Lowercased because the server's name always is: `projects.id` is a Postgres
    // `uuid`, which renders lowercase, and the engine builds the cookie prefix
    // from it. Cookie names are case-SENSITIVE, so a mixed-case id names a cookie
    // nothing ever set and the request reads as signed out for no visible reason.
    // ASCII-only on purpose: a uuid is ASCII, and full Unicode lowering would let
    // a non-ASCII byte map to something the other five SDKs would not agree on.
    let stripped: String = project_id
        .chars()
        .filter(|c| *c != '-')
        .map(|c| c.to_ascii_lowercase())
        .collect();
    if secure {
        format!("__Secure-p_{stripped}.session_token")
    } else {
        format!("p_{stripped}.session_token")
    }
}
