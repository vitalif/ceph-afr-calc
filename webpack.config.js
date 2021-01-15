const webpack = require('webpack');
const path = require('path');

module.exports = {
  entry: { 'main': [ './main.js' ] },
  context: __dirname,
  output: {
    path: __dirname,
    filename: './dist/[name].js'
  },
  devtool: 'cheap-module-source-map',
  module: {
    rules: [
      {
        test: /.jsx?$/,
        loader: 'babel-loader',
        exclude: /node_modules/
      }
    ]
  },
  plugins: [
    new webpack.DefinePlugin({
      "process.env": {
         NODE_ENV: JSON.stringify(process.env.NODE_ENV || "production")
       }
    })
  ]
};
