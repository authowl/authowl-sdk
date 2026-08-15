package authowl

import (
	"context"
	"errors"
	"io"
	"net/http"
	"sync"
	"time"
)

// StaticKeySource serves a fixed key set. Use it in tests, or when keys are
// provisioned out of band rather than fetched.
type StaticKeySource struct{ Keys []*JWK }

// NewStaticKeySource parses a JWKS document once and serves it forever.
func NewStaticKeySource(document []byte) (*StaticKeySource, error) {
	keys, err := ParseJWKS(document)
	if err != nil {
		return nil, err
	}
	return &StaticKeySource{Keys: keys}, nil
}

// ResolveKey implements KeySource.
func (s *StaticKeySource) ResolveKey(_ context.Context, kid string) (*JWK, error) {
	if key := pickKey(s.Keys, kid); key != nil {
		return key, nil
	}
	return nil, verr(ErrJWKSKeyNotFound, "no matching JWKS key for the token kid")
}

func pickKey(keys []*JWK, kid string) *JWK {
	if kid == "" {
		if len(keys) > 0 {
			return keys[0]
		}
		return nil
	}
	for _, key := range keys {
		if key.Kid == kid {
			return key
		}
	}
	return nil
}

const (
	jwksCacheTTL             = 5 * time.Minute
	jwksFetchTimeout         = 5 * time.Second
	jwksForceRefetchCooldown = time.Minute
)

// RemoteKeySource fetches and caches a project's published JWKS.
//
// An unknown `kid` may be a freshly rotated key, so it forces ONE cache-bypassing
// refetch to try to pick it up. That forced refetch is rate-limited: a flood of
// bogus-kid tokens must not turn into a flood of outbound JWKS requests, which
// would be a cheap amplification lever against the issuer. Legitimate rotation
// is unaffected - the server keeps signing with the old kid long enough for the
// normal TTL refresh to carry the new one.
type RemoteKeySource struct {
	URI    string
	Client *http.Client
	// Now is injectable for deterministic tests. Nil means time.Now.
	Now func() time.Time

	mu              sync.Mutex
	keys            []*JWK
	fetchedAt       time.Time
	lastForcedAt    time.Time
	haveFetchedOnce bool
}

// NewRemoteKeySource returns a key source that reads the project's JWKS URL.
func NewRemoteKeySource(uri string) *RemoteKeySource {
	return &RemoteKeySource{URI: uri}
}

func (r *RemoteKeySource) now() time.Time {
	if r.Now != nil {
		return r.Now()
	}
	return time.Now()
}

func (r *RemoteKeySource) client() *http.Client {
	if r.Client != nil {
		return r.Client
	}
	return &http.Client{Timeout: jwksFetchTimeout}
}

// ResolveKey implements KeySource.
func (r *RemoteKeySource) ResolveKey(ctx context.Context, kid string) (*JWK, error) {
	keys, err := r.load(ctx, false)
	if err != nil {
		return nil, err
	}
	if key := pickKey(keys, kid); key != nil {
		return key, nil
	}

	r.mu.Lock()
	now := r.now()
	mayForce := now.Sub(r.lastForcedAt) >= jwksForceRefetchCooldown
	if mayForce {
		r.lastForcedAt = now
	}
	r.mu.Unlock()

	if mayForce {
		refreshed, refreshErr := r.load(ctx, true)
		if refreshErr != nil {
			return nil, refreshErr
		}
		if key := pickKey(refreshed, kid); key != nil {
			return key, nil
		}
	}
	return nil, verr(ErrJWKSKeyNotFound, "no matching JWKS key for the token kid")
}

func (r *RemoteKeySource) load(ctx context.Context, force bool) ([]*JWK, error) {
	r.mu.Lock()
	fresh := r.haveFetchedOnce && r.now().Sub(r.fetchedAt) < jwksCacheTTL
	cached := r.keys
	r.mu.Unlock()
	if !force && fresh {
		return cached, nil
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, r.URI, nil)
	if err != nil {
		return nil, verr(ErrJWKSFetchFailed, "failed to build the JWKS request")
	}
	request.Header.Set("accept", "application/json")

	response, err := r.client().Do(request)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, verr(ErrJWKSFetchTimeout, "JWKS fetch timed out")
		}
		return nil, verr(ErrJWKSFetchFailed, "failed to fetch JWKS")
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode > 299 {
		return nil, verr(ErrJWKSHTTPError, "JWKS fetch returned a non-success status")
	}
	// Read one byte past the ceiling so an oversized body is detected rather than
	// silently truncated into a document that might still parse.
	body, err := io.ReadAll(io.LimitReader(response.Body, jwksMaxBytes+1))
	if err != nil {
		return nil, verr(ErrJWKSFetchFailed, "failed to read the JWKS response")
	}
	if len(body) > jwksMaxBytes {
		return nil, verr(ErrJWKSResponseTooLarge, "JWKS response exceeds the 64 KiB limit")
	}

	keys, err := ParseJWKS(body)
	if err != nil {
		return nil, err
	}

	r.mu.Lock()
	r.keys = keys
	r.fetchedAt = r.now()
	r.haveFetchedOnce = true
	r.mu.Unlock()
	return keys, nil
}
