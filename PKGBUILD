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
    'python-sounddevice'
    'python-pyserial'
    'python-cffi'
    'python-requests'
    'portaudio'
    'hamlib'
    'tk'
)
optdepends=(
    'nodejs: for embedded web application engine'
    'npm: for building web interface'
    'python-pyaudio: alternative audio backend'
)
makedepends=('python-setuptools' 'python-build' 'python-installer' 'python-wheel' 'git')
source=("z-30::git+https://github.com/themantas1994/z-30.git#branch=main")
sha256sums=('SKIP')

build() {
    if [ -d "$srcdir/z-30" ]; then
        cd "$srcdir/z-30"
    elif [ -f "$startdir/setup.py" ]; then
        cd "$startdir"
    else
        cd "$srcdir"
    fi
    python -m build --wheel --no-isolation
}

package() {
    if [ -d "$srcdir/z-30" ]; then
        cd "$srcdir/z-30"
    elif [ -f "$startdir/setup.py" ]; then
        cd "$startdir"
    else
        cd "$srcdir"
    fi

    python -m installer --destdir="$pkgdir" dist/*.whl

    # Desktop integration
    if [ -f z30.desktop ]; then
        install -Dm644 z30.desktop "$pkgdir/usr/share/applications/z30.desktop"
    fi
    if [ -f icon-512.svg ]; then
        install -Dm644 icon-512.svg "$pkgdir/usr/share/icons/hicolor/scalable/apps/z30.svg"
    fi
}
