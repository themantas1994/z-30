"""Structured LDPC codec with normalized and offset min-sum decoding."""

from __future__ import annotations

import numpy as np
from scipy.sparse import csr_matrix, lil_matrix


class OptimizedLDPCCodec:
    """IRA-style LDPC with syndrome early stopping."""

    def __init__(self, k: int = 91, n: int = 268, alpha: float = 0.8, beta: float = 0.5):
        self.k, self.n, self.m = k, n, n - k
        self.alpha = alpha
        self.beta = beta
        self.H: csr_matrix = self._generate_ira_matrix()
        self.var_to_chk = [self.H.getcol(j).nonzero()[0].tolist() for j in range(self.n)]
        self.chk_to_var = [self.H.getrow(i).nonzero()[1].tolist() for i in range(self.m)]

    def _generate_ira_matrix(self) -> csr_matrix:
        rng = np.random.default_rng(12345)
        H = lil_matrix((self.m, self.n), dtype=np.int8)
        for i in range(self.m):
            H[i, self.k + i] = 1
            if i > 0:
                H[i, self.k + i - 1] = 1

        col_weight = 3
        for j in range(self.k):
            placed = False
            for _ in range(50):
                rows = rng.choice(self.m, size=col_weight, replace=False)
                if all(H[r, j] == 0 for r in rows):
                    for r in rows:
                        H[r, j] = 1
                    placed = True
                    break
            if not placed:
                rows = rng.choice(self.m, size=col_weight, replace=False)
                for r in rows:
                    H[r, j] = 1
        return H.tocsr()

    def encode(self, info_bits: np.ndarray) -> np.ndarray:
        info = np.asarray(info_bits, dtype=np.int8).ravel()[: self.k]
        codeword = np.zeros(self.n, dtype=np.int8)
        codeword[: self.k] = info
        parity_sum = (self.H[:, : self.k].dot(info) % 2).astype(np.int8)
        p = np.zeros(self.m, dtype=np.int8)
        p[0] = parity_sum[0]
        for i in range(1, self.m):
            p[i] = (parity_sum[i] ^ p[i - 1]) % 2
        codeword[self.k :] = p
        return codeword

    def _syndrome_ok(self, hard: np.ndarray) -> bool:
        return int(np.sum(self.H.dot(hard) % 2)) == 0

    def decode(self, llrs: np.ndarray, max_iter: int = 30, algorithm: str = "normalized_min_sum", early_stop: bool = True) -> np.ndarray:
        if algorithm == "offset_min_sum":
            return self.decode_offset_min_sum(llrs, max_iter=max_iter, early_stop=early_stop)
        return self.decode_normalized_min_sum(llrs, max_iter=max_iter, early_stop=early_stop)

    def decode_normalized_min_sum(self, llrs: np.ndarray, max_iter: int = 30, early_stop: bool = True) -> np.ndarray:
        llrs = np.asarray(llrs, dtype=np.float64).ravel()
        L_q = np.zeros((self.m, self.n))
        L_r = np.zeros((self.m, self.n))
        for j in range(self.n):
            for i in self.var_to_chk[j]:
                L_q[i, j] = llrs[j]

        hard = np.zeros(self.n, dtype=np.int8)
        for _ in range(max_iter):
            for i in range(self.m):
                vars_in = self.chk_to_var[i]
                msgs = L_q[i, vars_in]
                signs = np.sign(msgs)
                signs[signs == 0] = 1
                mags = np.abs(msgs)
                total_sign = np.prod(signs)
                for idx, v in enumerate(vars_in):
                    others = np.delete(mags, idx)
                    min_mag = np.min(others) if len(others) else 0.0
                    L_r[i, v] = self.alpha * total_sign * signs[idx] * min_mag

            L_total = np.zeros(self.n)
            for j in range(self.n):
                chks = self.var_to_chk[j]
                L_total[j] = llrs[j] + np.sum(L_r[chks, j])
                for i in chks:
                    L_q[i, j] = L_total[j] - L_r[i, j]

            hard = (L_total < 0).astype(np.int8)
            if early_stop and self._syndrome_ok(hard):
                break
        return hard

    def decode_offset_min_sum(self, llrs: np.ndarray, max_iter: int = 30, early_stop: bool = True) -> np.ndarray:
        llrs = np.asarray(llrs, dtype=np.float64).ravel()
        L_q = np.zeros((self.m, self.n))
        L_r = np.zeros((self.m, self.n))
        for j in range(self.n):
            for i in self.var_to_chk[j]:
                L_q[i, j] = llrs[j]

        hard = np.zeros(self.n, dtype=np.int8)
        for _ in range(max_iter):
            for i in range(self.m):
                vars_in = self.chk_to_var[i]
                msgs = L_q[i, vars_in]
                signs = np.sign(msgs)
                signs[signs == 0] = 1
                mags = np.abs(msgs)
                total_sign = np.prod(signs)
                for idx, v in enumerate(vars_in):
                    others = np.delete(mags, idx)
                    if len(others) >= 2:
                        sorted_m = np.sort(others)
                        min_mag = max(sorted_m[0] - self.beta, 0.0)
                    elif len(others) == 1:
                        min_mag = max(others[0] - self.beta, 0.0)
                    else:
                        min_mag = 0.0
                    L_r[i, v] = total_sign * signs[idx] * min_mag

            L_total = np.zeros(self.n)
            for j in range(self.n):
                chks = self.var_to_chk[j]
                L_total[j] = llrs[j] + np.sum(L_r[chks, j])
                for i in chks:
                    L_q[i, j] = L_total[j] - L_r[i, j]

            hard = (L_total < 0).astype(np.int8)
            if early_stop and self._syndrome_ok(hard):
                break
        return hard
