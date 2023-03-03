const { Api, JsonRpc } = require('eosjs');
const {JsSignatureProvider} = require('eosjs/dist/eosjs-jssig');
const BigNumber = require('bignumber.js')
const ecc = require('eosjs/dist/eosjs-ecc-migration').ecc;
const fetch = require('node-fetch');                                    // node only; not needed in browsers
var numeric = require('./patch_numeric');
const inquirer = require("inquirer");

const exec = require('child_process').exec;

var privateKey = "";
var receiver = '';
var api = null;

function initAPI() {

  if(!privateKey) {
    console.log("privateKey is null");
    return;
  }

  const httpEndpoint = 'http://scontract.dmctech.io:32121'
  const chainId = "4d1fb981dd562d2827447dafa89645622bdcd4e29185d60eeb45539f25d2d85d";
  const signatureProvider = new JsSignatureProvider([privateKey]);

  api = new Api({
    rpc: new JsonRpc(httpEndpoint,{ fetch }),
    chainId,
    signatureProvider,
    textDecoder: new TextDecoder(),
    textEncoder: new TextEncoder()
  })
}

function char_to_symbol(c) {
  if (c >= 97 && c <= 122) return (c - 97) + 6
  if (c >= 49 && c <= 53) return (c - 49) + 1
  return 0
}

function stringToName(str) {
  const len = str.length

  let value = new BigNumber(0)

  for (let i = 0; i <= 12; ++i) {
    let c = 0
    if (i < len && i <= 12) {
      c = char_to_symbol(str.charCodeAt(i))
    }

    if (i < 12) {
      c &= 0x1f
      let b_c = new BigNumber(c)
      const two = new BigNumber(2)
      b_c = b_c.times(two.pow(64 - 5 * (i + 1)))
      value = value.plus(b_c)
    } else {
      c &= 0x0f
      value = value.plus(c)
    }
  }

  return value.toFixed()
}

async function get_dmc_balance(account) {
    var scopeName = stringToName(account);

    const result = await api.rpc.get_table_rows({
        "json": true,
        "code": "dmc.token",
        "scope": scopeName,
        "table": "accounts",
        "limit": 10
    });

    var balance =  result.rows[0].balance.quantity;
    return balance;
}

async function mergeTo(){

  let publicKey = ecc.privateToPublic(privateKey,'DM').toString()

  var where = {
      "pub_key": publicKey,
      "permission": "owner"
  };

  var query = encodeURIComponent(JSON.stringify(where));
  
  var acccount = await fetch('http://explorer.dmctech.io/1.1/permissions?where=' + query).then(res => res.json()).then(json => {
    return json;
  });

  var account = acccount?.[0]?.account_id;

  if(!account){
    console.log('account not found');
    return;
  }

  var bal = await get_dmc_balance(account);
  console.log('account:',account,'balance:',bal);

  var balance = bal.split(' ')[0];
  if(parseFloat(balance) == 0){
    console.log('balance is 0');
    return;
  }

  console.log(`sending all dmc to ${receiver}`); 

  //wait for user to confirm
  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: `Are you sure you want to send ${bal} to ${receiver}?`
    }
  ]);

  if(!confirm){
    console.log('cancelled');
    return;
  }

  const result = await api.transact({
      actions: [{
        account: 'dmc.token',
        name: 'transfer',
        authorization: [{
          actor: account,
          permission: 'active',
        }],
        data: {
          from: account,
          to: receiver,
          quantity: bal,
          memo: 'withdraw',
        },
      }]
  }, {
    broadcast: false,     
    sign: true,           
    blocksBehind: 3,
    expireSeconds: 30,
  });

  
  //pushSignedTransaction 
  const pushResult = await api.pushSignedTransaction(result);
  
  console.log(pushResult);
  var accountLink = 'http://explorer.dmctech.io/details/' + account;
  exec(`open ${accountLink}`);
}


console.log("Welcome to DMC Wallet Merger"); 
const schema = [
    {
      type: "input",
      name: "privateKey",
      message: "Enter Private Key:",
      required: true,
    },
    {
      type: "input",
      name: "receiver",
      message: "Enter Receiver: ",
      required: true,
    }
];

inquirer.prompt(schema).then(async (answers) => {
  privateKey = answers.privateKey;
  receiver = answers.receiver;

  if(!privateKey){
    console.log("privateKey is null");
    return;
  }

  if(!receiver){
    console.log("receiver is null");
    return;
  }

  //make sure receiver is valid
  initAPI();
  var bal = await get_dmc_balance(receiver);
  console.log(`receiver: ${receiver} balance: ${bal}`)

  await mergeTo();
});
