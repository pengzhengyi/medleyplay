package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/netip"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
)

const peerHeader = "X-Medleyplay-Share-Peer"

func main() {
	bind := flag.String("bind", "", "private IPv4 address and TCP port to share on")
	private := flag.String("private", "", "path to the Uvicorn Unix socket")
	flag.Parse()
	if err := serve(*bind, *private); err != nil {
		log.Fatal(err)
	}
}

func serve(bind, private string) error {
	if os.Geteuid() == 0 || !validBind(bind) || private == "" {
		return errors.New("Share requires an unprivileged user, private IPv4 address, and upstream socket")
	}
	listener, err := net.Listen("tcp4", bind)
	if err != nil {
		return err
	}
	defer listener.Close()

	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{Timeout: time.Second}).DialContext(ctx, "unix", private)
		},
		DisableCompression: true,
		IdleConnTimeout:    30 * time.Second,
	}
	defer transport.CloseIdleConnections()

	server := &http.Server{
		Handler:           relay(transport),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       30 * time.Second,
		MaxHeaderBytes:    64 << 10,
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		// Uvicorn owns this pipe's write end, so EOF also stops sharing after an abrupt exit.
		_, _ = io.Copy(io.Discard, os.Stdin)
		stop()
	}()
	go func() {
		<-ctx.Done()
		_ = server.Close()
	}()
	fmt.Println(listener.Addr())
	if err := server.Serve(listener); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func relay(transport http.RoundTripper) *httputil.ReverseProxy {
	return &httputil.ReverseProxy{
		Transport: transport,
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(&url.URL{Scheme: "http", Host: "private"})
			r.Out.Host = r.In.Host
			r.Out.Header.Del("X-Real-IP")
			r.Out.Header.Del("Via")
			peer, _, _ := net.SplitHostPort(r.In.RemoteAddr)
			r.Out.Header.Set(peerHeader, peer)
		},
	}
}

func validBind(bind string) bool {
	host, port, err := net.SplitHostPort(bind)
	if err != nil {
		return false
	}
	address, err := netip.ParseAddr(host)
	if err != nil || !address.Is4() || !address.IsPrivate() {
		return false
	}
	value, err := strconv.ParseUint(port, 10, 16)
	return err == nil && value != 0
}
