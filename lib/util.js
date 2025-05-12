// Create a priority queue with a comparison function (min by default).
export const Queue = (cmp = (a, b) => a - b) => Object.assign([], queue, { cmp });

const queue = {
    insert(x) {
        this.push(x);
        for (let i = this.length - 1; i > 0;) {
            // Index of parent
            const j = Math.floor((i - 1) / 2);
            if (this.cmp(x, this[j]) >= 0) {
                break;
            }
            this[i] = this[j];
            this[j] = x;
            i = j;
        }
        return x;
    },

    remove(at = 0) {
        const n = this.length - 1;
        if (n < 0) {
            return;
        }
        const last = this.pop();
        if (n === at) {
            return last;
        }
        const removed = this[at];
        this[at] = last;
        for (let i = at;;) {
            // Index of left and right children
            const j = 2 * i + 1;
            if (j >= n) {
                // No children
                break;
            }
            const k = j + 1;
            if (this.cmp(this[i], this[j]) <= 0) {
                // parent < left
                if (k >= n || this.cmp(this[i], this[k]) <= 0) {
                    // parent < right
                    break;
                }
                // parent > right, swap with right
                this[i] = this[k];
                this[k] = last;
                i = k;
            } else {
                // parent > left
                if (k >= n || this.cmp(this[j], this[k]) <= 0) {
                    this[i] = this[j];
                    this[j] = last;
                    i = j;
                } else if (k < n) {
                    this[i] = this[k];
                    this[k] = last;
                    i = k;
                } else {
                    break;
                }
            }
        }
        return removed;
    }
};
