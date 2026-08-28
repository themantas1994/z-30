# Maintainer: z-30 Working Group <dev@z30mode.org>
pkgname=z30-transceiver
pkgver=1.0.0
pkgrel=1
pkgdesc="16-MFSK Weak-Signal Digital Mode Transceiver, LDPC-SIC Decoder, CAT Controller, and DSP Suite"
arch=('x86_64' 'aarch64' 'armv7h')
url="https://github.com/z30mode/z30-transceiver"
license=('MIT')
depends=(
    'python>=3.9'
    'python-numpy'
    'python-scipy'
    'python-sounddevice'
    'python-pyserial'
    'python-cffi'
    'portaudio'
    'hamlib'
    'tk'
)
optdepends=(
    'nodejs: for embedded web application engine'
    'npm: for building web interface'
    'python-pyaudio: alternative audio backend'
)
makedepends=('python-setuptools' 'python-build' 'python-installer' 'python-wheel')
source=("$pkgname-$pkgver.tar.gz::https://github.com/z30mode/z30-transceiver/archive/v$pkgver.tar.gz")
sha256sums=('SKIP')

build() {
    cd "$srcdir"
    python -m build --wheel --no-isolation
}

package() {
    cd "$srcdir"
    python -m installer --destdir="$pkgdir" dist/*.whl
    
    # Desktop integration
    install -Dm644 z30.desktop "$pkgdir/usr/share/applications/z30.desktop"
    install -Dm644 icon-512.svg "$pkgdir/usr/share/icons/hicolor/scalable/apps/z30.svg"
}
