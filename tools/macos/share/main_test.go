package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type capturedUpstream struct {
	request *http.Request
}

func (upstream *capturedUpstream) RoundTrip(request *http.Request) (*http.Response, error) {
	upstream.request = request
	return &http.Response{
		StatusCode: http.StatusPartialContent,
		Header:     http.Header{"Content-Range": {"bytes 1-3/8"}},
		Body:       io.NopCloser(strings.NewReader("abc")),
	}, nil
}

func TestRelayRecordsTheSocketPeerAndPreservesAudioRange(t *testing.T) {
	upstream := &capturedUpstream{}
	request := httptest.NewRequest(http.MethodGet, "http://192.168.1.20:8123/audio", nil)
	request.RemoteAddr = "192.168.1.42:50001"
	request.Header.Set(peerHeader, "192.168.1.9")
	request.Header.Set("X-Forwarded-For", "192.168.1.9")
	request.Header.Set("Range", "bytes=1-3")
	response := httptest.NewRecorder()

	relay(upstream).ServeHTTP(response, request)

	if upstream.request == nil {
		t.Fatal("request did not reach Uvicorn")
	}
	if peer := upstream.request.Header.Get(peerHeader); peer != "192.168.1.42" {
		t.Errorf("observed peer = %q, want 192.168.1.42", peer)
	}
	if peer := upstream.request.Header.Get("X-Forwarded-For"); peer != "" {
		t.Errorf("client forwarding header passed through: %q", peer)
	}
	if host := upstream.request.Host; host != "192.168.1.20:8123" {
		t.Errorf("host = %q, want the browser's host and port", host)
	}
	if got := upstream.request.Header.Get("Range"); got != "bytes=1-3" {
		t.Errorf("upstream range = %q, want bytes=1-3", got)
	}
	if response.Code != http.StatusPartialContent || response.Body.String() != "abc" {
		t.Errorf("audio response = %d %q, want 206 abc", response.Code, response.Body)
	}
}

func TestBindRequiresOnePrivateIPv4AddressAndAPort(t *testing.T) {
	for _, invalid := range []string{
		":8000", "0.0.0.0:8000", "127.0.0.1:8000", "[::1]:8000",
		"198.51.100.10:8000", "192.168.1.20:0", "192.168.1.20:65536",
	} {
		if validBind(invalid) {
			t.Errorf("accepted unsupported binding %s", invalid)
		}
	}
	if !validBind("192.168.1.20:8000") {
		t.Error("rejected a private LAN address")
	}
}
