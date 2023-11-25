const proto = {
    insert(item) {
        this.push(item);
        for (let i = this.length - 1; i > 0;) {
            // Index of parent
            const j = Math.floor((i - 1) / 2);
            if (this.cmp(item, this[j]) >= 0) {
                break;
            }
            this[i] = this[j];
            this[j] = item;
            i = j;
        }
        return item;
    },

    remove() {
        const n = this.length - 1;
        if (n < 0) {
            return;
        }
        const last = this.pop();
        if (n === 0) {
            return last;
        }
        const top = this[0];
        this[0] = last;
        for (let i = 0;;) {
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
        return top;
    },

    *values() {
        const copy = this.slice();
        Object.assign(copy, proto, { cmp: this.cmp });
        while (copy.length > 0) {
            yield copy.remove();
        }
    },
};

export function Queue(cmp) {
    const queue = [];
    Object.assign(queue, proto, { cmp });
    return queue;
};
