function validImageBytes(mimeType,buffer){
  if(!Buffer.isBuffer(buffer)||buffer.length<4)return false;
  if(mimeType==="image/jpeg")return buffer[0]===0xff&&buffer[1]===0xd8&&buffer[2]===0xff;
  if(mimeType==="image/png")return buffer.length>=8&&buffer[0]===0x89&&buffer[1]===0x50&&buffer[2]===0x4e&&buffer[3]===0x47&&buffer[4]===0x0d&&buffer[5]===0x0a&&buffer[6]===0x1a&&buffer[7]===0x0a;
  if(mimeType==="image/webp")return buffer.length>=12&&buffer.subarray(0,4).toString("ascii")==="RIFF"&&buffer.subarray(8,12).toString("ascii")==="WEBP";
  return false;
}
module.exports={validImageBytes};
