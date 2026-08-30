# Maintainer: Paulo Mantas <paulomantas2009@gmail.com>
pkgname=z30-transceiver
pkgver=1.0.0
pkgrel=1
pkgdesc="16-MFSK Weak-Signal Digital Mode Transceiver, LDPC-SIC Decoder, CAT Controller, and DSP Suite"
arch=('x86_64' 'aarch64' 'armv7h')
url="https://github.com/themantas1994/z-30"
license=('MIT')
depends=(
    'python>=3.9'
    'python-numpy'
    'python-scipy'
    'python-pyserial'
    'python-cffi'
    'python-requests'
    'portaudio'
    'hamlib'
    'tk'
)
optdepends=(
    'python-sounddevice: hardware audio capture & playback (available in AUR or via pip)'
    'python-pyaudio: alternative audio backend'
    'nodejs: for embedded web application engine'
    'npm: for building web interface'
)
makedepends=('python-setuptools' 'python-build' 'python-installer' 'python-wheel' 'nodejs' 'npm' 'git')
source=("z-30::git+https://github.com/themantas1994/z-30.git#branch=main")
sha256sums=('SKIP')

build() {
    if [ -d "$srcdir/z-30" ]; then
        cd "$srcdir/z-30"
    elif [ -f "$startdir/pyproject.toml" ]; then
        cd "$startdir"
    else
        cd "$srcdir"
    fi

    if command -v npm &> /dev/null; then
        npm install
        npm run build
        mkdir -p z30_dsp/web_dist
        cp -r dist/* z30_dsp/web_dist/ 2>/dev/null || true
    fi

    python -m build --wheel --no-isolation
}

package() {
    if [ -d "$srcdir/z-30" ]; then
        cd "$srcdir/z-30"
    elif [ -f "$startdir/pyproject.toml" ]; then
        cd "$startdir"
    else
        cd "$srcdir"
    fi

    python -m installer --destdir="$pkgdir" dist/*.whl

    # Desktop integration
    if [ -f z30.desktop ]; then
        install -Dm644 z30.desktop "$pkgdir/usr/share/applications/z30.desktop"
    fi
    if [ -f public/icon-512.svg ]; then
        install -Dm644 public/icon-512.svg "$pkgdir/usr/share/icons/hicolor/scalable/apps/z30.svg"
    fi

    # The AUR requires the licence text to be installed. There was no LICENSE file in the tree
    # at all until recently, despite four places declaring MIT - which made this package (and
    # Debian packaging, and any fork) legally undistributable.
    install -Dm644 LICENSE "$pkgdir/usr/share/licenses/$pkgname/LICENSE"
}
