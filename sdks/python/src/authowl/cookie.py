"""Session cookie-name derivation."""

from __future__ import annotations


def session_cookie_name(project_id: str, *, secure: bool = False) -> str:
    """The exact session-cookie name the AuthOwl server sets for a project.

    ``dev  (http):  p_<idNoDashes>.session_token``
    ``prod (https): __Secure-p_<idNoDashes>.session_token``

    Note the DOT joining the prefix and the name, and the ``__Secure-`` (not
    ``__Host-``) prefix - both are easy to get wrong by hand, and getting either
    wrong means reading a cookie the server never set.

    ``secure`` must reflect the SERVER's cookie mode: derive it from the API
    URL's scheme (https => True), not from the local request.
    """
    # Lowercased because the server's name always is: ``projects.id`` is a
    # Postgres ``uuid``, which renders lowercase, and the engine builds the
    # cookie prefix from it. Cookie names are case-SENSITIVE, so a mixed-case id
    # names a cookie nothing ever set and the request reads as signed out.
    name = f"p_{project_id.lower().replace('-', '')}.session_token"
    return f"__Secure-{name}" if secure else name
