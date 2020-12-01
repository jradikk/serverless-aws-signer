exports.handler =  async function(event, context) {
    console.log("EVENT: \n" + JSON.stringify(event, null, 2))
    return JSON.stringify({
        statusCode: 200,
        body: "bla"
    })
  }