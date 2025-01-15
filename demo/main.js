import Alpine from 'alpinejs';
import HTMLMinifier from '../dist/htmlminifier.esm.bundle.js';
import pkg from '../package.json';
import defaultOptions from './defaultOptions.js';
import Pako from 'pako';
const fileToResult = async (file) => {
  return new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.readAsText(file);
    reader.onload = () => {
      resolve(reader.result);
    };
  });
};
const percentage = (a, b) => {
  const diff = a - b;
  const savings = ((100 * diff / a) || 0).toFixed(2);
  return savings;
};

const sillyClone = (o) => JSON.parse(JSON.stringify(o));

const getOptions = (options) => {
  const minifierOptions = {};

  options.forEach((option) => {
    let value = null;

    if (option.type === 'checkbox') {
      value = Boolean(option.checked);
    } else if (!option.value) {
      return;
    } else if (option.type === 'number') {
      value = parseInt(option.value);
    } else {
      value = option.value;
    }

    if (option.id === 'processScripts') {
      value = value.split(/\s*,\s*/);
    }

    minifierOptions[option.id] = value;
  });

  return minifierOptions;
};

Alpine.data('minifier', () => ({
  options: sillyClone(defaultOptions),
  input: '',
  output: '',
  stats: {
    result: '',
    text: '',
    variants: []
  },
  support: {
    fileReader: 'FileReader' in window
  },
  compress(alg, data, level, elapsed = 0) {
    const start = performance.now();
    const compressed =
      alg === 'raw'
        ? data
        : Pako[alg](data, {
          level
        });
    return {
      size: compressed.length,
      elapsed: (elapsed + performance.now() - start).toFixed(2)
    };
  },
  async selectFile(event) {
    this.minify(await Promise.all(
      [...event.target.files].map(async (file) => ({
        name: file.name,
        value: await fileToResult(file)
      }))
    ));
  },
  async minifyHTML(code, options) {
    try {
      return [null, await HTMLMinifier.minify(code, options)];
    } catch (error) {
      return [error, code];
    }
  },
  async minifyInput() {
    this.minify([
      {
        name: 'Input',
        value: this.input
      }
    ]);
  },
  async variants(name, value) {
    const options = getOptions(this.options);
    const optionVariants = [
      ['Attribute With Quotes', {
        removeAttributeQuotes: false
      }],
      ['Attribute Without Quotes', {
        removeAttributeQuotes: true
      }]
    ];
    const results = await Promise.all(optionVariants.map(async ([variantName, variantOptions]) =>
      this.minifyVariants(
        `${name} ${variantName}`, value, {
          ...options,
          ...variantOptions
        })
    ));
    const err = results.filter(r => r.err).map(r => r.err).join('\n');
    const variants = results.flatMap(r => r.variants);
    return { err, variants };
  },
  async minifyVariants(name, value, options) {
    const start = performance.now();
    const [err, data] = await this.minifyHTML(value, options);
    const end = performance.now() - start;
    const algorithms = ['gzip', 'deflate'];
    const levels = [4, 6, 9];
    const variants = [
      [`${name} minified`, data, end],
      [`${name} raw`, value, 0]
    ].flatMap(([title, data, elapsed]) => (
      [
        { data, value, title, compression: this.compress('raw', data, 0) },
        ...algorithms.flatMap((alg) =>
          levels.map(
            level => ({
              value,
              data,
              title: `${title} ${alg} ${level}`,
              compression: this.compress(alg, data, level)
            })
          )
        )
      ]
    ));
    return { err, variants };
  },
  async minify(values) {
    this.stats = {
      result: '',
      text: '',
      variants: []
    };
    try {
      const results = await Promise.all(values.map(({ name, value }) => this.variants(name, value)));
      const variants = results.flatMap(result => result.variants).sort((a, b) => a.compression.size - b.compression.size);
      const errors = results.filter(result => result.err).map(result => '' + result.err);
      this.stats.variants = variants;
      variants && this.selectVariant(variants[0]);
      if (errors.length) {
        throw new Error(errors.join('\n'));
      }
    } catch (err) {
      this.stats.result = 'failure';
      this.stats.text = err + '';
      console.error(err);
    }
  },
  selectVariant(selectedVariant) {
    this.selectedVariant = selectedVariant;
    this.input = selectedVariant.value;
    this.output = selectedVariant.data;
    this.stats.variants.forEach(variant => {
      variant.ratio = {
        size: percentage(selectedVariant.compression.size, variant.compression.size),
        elapsed: percentage(selectedVariant.compression.elapsed, variant.compression.elapsed)
      };
    });
  },
  selectAllOptions(yes = true) {
    this.options = this.options.map((option) => {
      if (option.type !== 'checkbox') {
        return option;
      }

      return {
        ...option,
        checked: Boolean(yes)
      };
    });
  },

  resetOptions() {
    this.options = sillyClone(defaultOptions);
  }
}));

Alpine.start();

document.getElementById('minifer-version').innerText = `(v${pkg.version})`;
