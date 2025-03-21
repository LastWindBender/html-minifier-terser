import 'lodash.product';
import _ from 'lodash';
import Alpine from 'alpinejs';
import HTMLMinifier from '../dist/htmlminifier.esm.bundle.js';
import pkg from '../package.json';
import defaultOptions from './defaultOptions.js';
import Pako from 'pako';

const minifierVariants = [
  ['raw', null],
  [
    'Sorted Attributes', {
      sortAttributes: true,
      sortClassName: true,
    }
  ],
  [
    'Unsorted Attributes', {
      sortAttributes: false,
      sortClassName: false,
    }
  ],
  [
    'Attribute With Quotes',
    {
      removeAttributeQuotes: false,
      removeTagWhitespace: false,
    }
  ],
  [
    'Attribute Without Quotes',
    {
      removeAttributeQuotes: true,
      removeTagWhitespace: true,
    }
  ]
];

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
  const savings = ((100 * diff) / a || 0).toFixed(2);
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
  selectedVariant: null,
  compress(alg, data, level) {
    const start = performance.now();
    const compressed =
      alg === 'raw'
        ? data
        : Pako[alg](data, {
          level
        });
    return {
      size: compressed.length,
      elapsed: (performance.now() - start).toFixed(2)
    };
  },
  async selectFile(event) {
    this.minify(
      await Promise.all(
        [...event.target.files].map(async (file) => ({
          name: file.name,
          value: await fileToResult(file)
        }))
      )
    );
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

  dataUrl() {
    return `data:text/html,${encodeURIComponent(this.selectedVariant.data)}`;
  },
  async variants(name, value) {
    const options = getOptions(this.options);
    let err = null;
    const sources = await Promise.all(
      minifierVariants.map(async ([name, minifierOptions]) => {
        if (minifierOptions == null) {
          return { name, data: value };
        }
        minifierOptions = { ...options, ...minifierOptions };
        const [minifierErr, data] = await this.minifyHTML(value, minifierOptions);
        err = minifierErr;
        return { name, data };
      })
    );
    const levels = (options.compressionLevels || '').split(',').filter(Boolean).filter(Boolean).map(
      (level) => parseInt(level)
    );
    const algorithms = (options.compressionAlgorithms || '').split(',');
    const algLevels = [
      ['raw', 0],
      ..._.product(algorithms, levels)
    ];
    const variants = _.product(sources, algLevels).map(
      async ([{ name: optionName, data }, [alg, level]]) => {
        const minifiedTitle = optionName === 'raw' ? '' : ` ${optionName}`;
        const algTitle = alg === 'raw' ? '' : ` ${alg} ${level}`;
        return ({
          name,
          value,
          data,
          title: `${name}${minifiedTitle}${algTitle}`,
          compression: this.compress(alg, data, level)
        });
      }
    );
    return { err, variants: await Promise.all(variants) };
  },
  async minify(values) {
    this.stats = {
      result: '',
      text: '',
      variants: []
    };
    try {
      const results = await Promise.all(
        values.map(({ name, value }) => this.variants(name, value))
      );
      const variants = results
        .flatMap((result) => result.variants)
        .sort((a, b) => a.compression.size - b.compression.size);
      const errors = results
        .filter((result) => result.err)
        .map((result) => '' + result.err);
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
    this.stats.variants.forEach((variant) => {
      variant.ratio = {
        size: percentage(
          selectedVariant.compression.size,
          variant.compression.size
        ),
        elapsed: percentage(
          selectedVariant.compression.elapsed,
          variant.compression.elapsed
        )
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
