module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.bulkInsert('Users', [{
      googleID: '113930504910589974147',
      displayName: 'Alex Letwin',
      email: 'alexanderletwin@gmail.com',
      photoURL: 'https://lh3.googleusercontent.com/a-/ALV-UjU1QnxQmfH51RgcVqQlEcmQBa_zeC5a5Dc3OjalJGWBURHCMTSlMTm978wFaZhqcmYufZfJI3vxVsKae0qcGYUjMsKt71-LMPf7vC75EAXOwKectXTSh__kvqHAciFdReAnZjqzrqDvp4J-KWflD2AE2x4auhInKm7gFrO8DNRtwkcD_ZNFsD8hCuquuHazpQZA0lQD4-VhZLPDybdidZ2tcsEEr7olehBNs_fg7kp_5EtXKT2dBhzaghpsgP2ZJOB-liOAB3IaaBctNq-IoNdmakw4MNYP9B4c9Uo6Z1j_tsGAoBQCgEPIU68PdY26UegVDZmVc1o9_Dvxl-PUZnoDHidWrTjUmFS3ms2n_vKz_0A9KxB1cCfUhsIEj5JPioaHtgoe0225Kpd9eKki-D1ekgluKMyG2G65Y1y8mtU98vhBeWGslmwitMr2mWMxgUmr5HmBXdky-s9E2ZvZuIC4tRM7U1MNy4K1fB4A-KJducgafxEZGrUkglvq6JCSeoytNRQNel3lauPfx5KEO7ZpswcrmD5XLah6smzJ1rBqdDMR0CT91kZdd-RgUHDwUO3YrCmBmB7iC8uTFWghkz4Db1YWOZiz2MFOlziKmDcIMsxs6KED0j8RPCljbdf81u1CBzOokafUVVI-0rq6zFVcKhR4G_6K438m-RGrzVNzdtx-D_p-3L8acJGlvYfvXG3grFqe6m_eDeb6tUGtEryjHeFkKAO-tC28AseyY5ILhuXQ2QyhjNHO0bBnAVHExHVn5iUesN5YNCzPJDJweDRPdq5OCPbZSe9LlixlMWaizN6bjnVeqgzLd5mhCT_B8BVmYcj-9UA6tucUgU9cqi56Atg8YOi2Mum5oX-oohzQFi2H3r5QzteXoIi8uNbolQtgDNt0hJ14HX4by74yE-lxISE39sU3oik_aFRyLeODP2ZKSAb4XG6t6SwQGBBT4dQ_n-g_kbfLoQI2MB38-BUxIF8s=s96-c',
      activeFlag: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }]);
  },
  down: (queryInterface, Sequelize) => {
    return queryInterface.bulkDelete('Users', null, {});
  }
};