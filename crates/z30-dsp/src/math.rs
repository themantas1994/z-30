//! Numerics shared by the demodulator: the modified Bessel function ln I0 (Cephes, NumPy's
//! `i0`), log-sum-exp, and small complex helpers.

fn chbevl(x: f64, c: &[f64]) -> f64 {
    let mut b0 = c[0];
    let mut b1 = 0.0;
    let mut b2 = 0.0;
    for &ci in &c[1..] {
        b2 = b1;
        b1 = b0;
        b0 = x * b1 - b2 + ci;
    }
    0.5 * (b0 - b2)
}

const I0_A: [f64; 30] = [
    -4.415_341_646_479_339_379_50E-18,
    3.330_794_518_822_238_097_83E-17,
    -2.431_279_846_547_954_693_59E-16,
    1.715_391_285_555_133_030_61E-15,
    -1.168_533_287_799_345_168_08E-14,
    7.676_185_498_604_935_616_88E-14,
    -4.856_446_783_111_929_460_90E-13,
    2.955_052_663_129_639_834_61E-12,
    -1.726_826_291_441_555_707_23E-11,
    9.675_809_035_373_236_912_24E-11,
    -5.189_795_601_635_262_906_66E-10,
    2.659_823_724_682_386_650_35E-9,
    -1.300_025_009_986_248_042_12E-8,
    6.046_995_022_541_918_949_32E-8,
    -2.670_793_853_940_611_733_91E-7,
    1.117_387_539_120_103_718_15E-6,
    -4.416_738_358_458_750_563_59E-6,
    1.644_844_807_072_889_708_93E-5,
    -5.754_195_010_082_103_703_98E-5,
    1.885_028_850_958_416_557_29E-4,
    -5.763_755_745_385_823_658_85E-4,
    1.639_475_616_941_335_798_42E-3,
    -4.324_309_995_050_575_944_30E-3,
    1.054_646_039_459_499_831_83E-2,
    -2.373_741_480_589_946_881_56E-2,
    4.930_528_423_967_070_848_78E-2,
    -9.490_109_704_804_764_442_10E-2,
    1.716_209_015_222_087_753_49E-1,
    -3.046_826_723_431_983_986_83E-1,
    6.767_952_744_094_760_849_95E-1,
];

const I0_B: [f64; 25] = [
    -7.233_180_487_874_753_954_56E-18,
    -4.830_504_485_944_182_071_26E-18,
    4.465_621_420_296_759_999_01E-17,
    3.461_222_867_697_461_093_10E-17,
    -2.827_623_980_516_583_484_94E-16,
    -3.425_485_619_677_219_134_62E-16,
    1.772_560_133_056_526_383_60E-15,
    3.811_680_669_352_622_420_75E-15,
    -9.554_846_698_828_307_648_70E-15,
    -4.150_569_347_287_222_086_63E-14,
    1.540_086_217_521_409_826_91E-14,
    3.852_778_382_742_142_701_14E-13,
    7.180_124_451_383_666_233_67E-13,
    -1.794_178_531_506_806_117_78E-12,
    -1.321_581_184_044_771_311_88E-11,
    -3.149_916_527_963_241_364_54E-11,
    1.188_914_710_784_643_834_24E-11,
    4.940_602_388_224_969_589_10E-10,
    3.396_232_025_708_386_345_15E-9,
    2.266_668_990_498_178_064_59E-8,
    2.048_918_589_469_063_741_83E-7,
    2.891_370_520_834_756_482_97E-6,
    6.889_758_346_916_823_984_26E-5,
    3.369_116_478_255_694_089_90E-3,
    8.044_904_110_141_088_316_08E-1,
];

/// I0(x), Cephes (identical to NumPy's `np.i0`).
pub fn i0(x: f64) -> f64 {
    let x = x.abs();
    if x <= 8.0 {
        x.exp() * chbevl(x / 2.0 - 2.0, &I0_A)
    } else {
        x.exp() * chbevl(32.0 / x - 2.0, &I0_B) / x.sqrt()
    }
}

/// The non-coherent tone metric ln I0(z), with the reference's large-argument asymptote.
#[inline]
pub fn ln_i0_metric(z: f64) -> f64 {
    if z > 15.0 {
        z - 0.5 * (2.0 * std::f64::consts::PI * z).max(1.0).ln()
    } else {
        i0(z).max(1e-12).ln()
    }
}

/// Numerically stable log(sum(exp(v))) over eight values, summed in NumPy's pairwise order
/// (the reference's `_log_sum_exp` on an 8-element array) so the LLRs match it bit for bit.
#[inline]
pub fn log_sum_exp8(v: &[f64; 8]) -> f64 {
    let m = v.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    if !m.is_finite() {
        return m;
    }
    let e: [f64; 8] = std::array::from_fn(|i| (v[i] - m).exp());
    m + (((e[0] + e[1]) + (e[2] + e[3])) + ((e[4] + e[5]) + (e[6] + e[7]))).ln()
}

/// Exact Log-MAP demapping of 16 tone log-likelihoods to four bit LLRs (MSB first, positive =
/// bit 0), clipped to +-25, as the reference does.
pub fn demap16(likes: &[f64; 16]) -> [f32; 4] {
    let mut out = [0.0f32; 4];
    for (bit, o) in out.iter_mut().enumerate() {
        let mask = 1usize << (3 - bit);
        let mut l0 = [0.0f64; 8];
        let mut l1 = [0.0f64; 8];
        let (mut a, mut b) = (0, 0);
        for (t, &l) in likes.iter().enumerate() {
            if t & mask == 0 {
                l0[a] = l;
                a += 1;
            } else {
                l1[b] = l;
                b += 1;
            }
        }
        *o = (log_sum_exp8(&l0) - log_sum_exp8(&l1)).clamp(-25.0, 25.0) as f32;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn i0_known_values() {
        assert!((i0(0.0) - 1.0).abs() < 1e-15);
        assert!((i0(1.0) - 1.266_065_877_752_008_4).abs() < 1e-14);
        assert!((i0(10.0) - 2815.716628466254).abs() / 2815.7 < 1e-14);
    }

    #[test]
    fn asymptote_switch_matches_the_reference_step() {
        // The reference switches to z - ln(2 pi z)/2 above 15 without the 1/(8z) correction,
        // a step of ~0.008 in a log-likelihood of ~13. Kept: it is part of the LLRs the
        // published thresholds were measured with.
        let a = ln_i0_metric(15.0);
        let b = ln_i0_metric(15.000_001);
        assert!((a - b).abs() < 0.01);
    }
}
